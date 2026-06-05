import { NextResponse } from "next/server";
import { ChatTogetherAI } from "@langchain/community/chat_models/togetherai";
import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import Together from "together-ai";
import { db } from "@/db/index";
import { textChunks, structuralMetadata } from "@/db/schema";
import { cosineDistance, desc, sql, eq, inArray } from "drizzle-orm";

const together = new Together({
  apiKey: process.env.TOGETHER_API_KEY,
});

const llm = new ChatTogetherAI({
  model: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
  temperature: 0.1,
  maxTokens: 1024,
  togetherAIApiKey: process.env.TOGETHER_API_KEY,
});

// Define LangGraph State
const StateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (existing, incoming) => existing.concat(incoming),
    default: () => [],
  }),
  context: Annotation<string>({
    reducer: (_existing, incoming) => incoming,
    default: () => "",
  }),
  sectionId: Annotation<string | null>({
    reducer: (_existing, incoming) => incoming,
    default: () => null,
  }),
});

/**
 * Collects all section IDs that should be included in the context scope:
 * the target section itself plus its direct children.
 */
async function collectScopedSectionIds(sectionId: string): Promise<string[]> {
  const childSections = await db
    .select({ id: structuralMetadata.id })
    .from(structuralMetadata)
    .where(eq(structuralMetadata.parentSectionId, sectionId));

  const sectionIds = [sectionId, ...childSections.map(child => child.id)];

  // Also include the parent section for broader context
  const [currentSection] = await db
    .select({ parentSectionId: structuralMetadata.parentSectionId })
    .from(structuralMetadata)
    .where(eq(structuralMetadata.id, sectionId));

  if (currentSection?.parentSectionId) {
    sectionIds.push(currentSection.parentSectionId);
  }

  return sectionIds;
}

// Node 1: Retrieve context from Neon pgvector
async function retrieveNode(state: typeof StateAnnotation.State) {
  const messages = state.messages;
  const lastMessage = messages[messages.length - 1];
  const queryText = lastMessage.content.toString();
  const activeSectionId = state.sectionId;

  // 1. Embed the query
  const embeddingsResponse = await together.embeddings.create({
    model: "intfloat/multilingual-e5-large-instruct",
    input: [queryText],
  });
  const queryVector = embeddingsResponse.data[0].embedding;

  // 2. Search Neon DB — scoped to section if provided, otherwise global
  const similarity = sql<number>`1 - (${cosineDistance(textChunks.embedding, queryVector)})`;

  let results;
  if (activeSectionId) {
    const scopedSectionIds = await collectScopedSectionIds(activeSectionId);
    results = await db
      .select({
        content: textChunks.content,
        similarity,
      })
      .from(textChunks)
      .where(inArray(textChunks.sectionId, scopedSectionIds))
      .orderBy(desc(similarity))
      .limit(5);
  } else {
    results = await db
      .select({
        content: textChunks.content,
        similarity,
      })
      .from(textChunks)
      .orderBy(desc(similarity))
      .limit(5);
  }

  const contextString = results.map((result, index) => `[Document ${index + 1}]:\n${result.content}`).join("\n\n");
  
  return { context: contextString };
}

// Node 2: Generate answer using retrieved context
async function generateNode(state: typeof StateAnnotation.State) {
  const context = state.context;
  const messages = state.messages;

  const systemMessage = new SystemMessage(
    `You are a brilliant senior data engineer acting as a mentor.
    Answer the user's question about data-intensive applications using the following retrieved context.
    If the context doesn't contain the answer, rely on your knowledge but clarify that it's outside the provided book excerpts.
    Keep your explanations clear, conceptual, and encouraging.
    
    Context:
    ${context}`
  );

  // Invoke the LLM with the system prompt + conversation history
  const response = await llm.invoke([systemMessage, ...messages]);
  return { messages: [response] };
}

// Build Graph
const workflow = new StateGraph(StateAnnotation)
  .addNode("retrieve", retrieveNode)
  .addNode("generate", generateNode)
  .addEdge(START, "retrieve")
  .addEdge("retrieve", "generate")
  .addEdge("generate", END);

const ragApplication = workflow.compile();

export async function POST(req: Request) {
  try {
    const { message, sectionId } = await req.json();

    if (!message) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    // Execute LangGraph with optional section scope
    const finalState = await ragApplication.invoke({
      messages: [new HumanMessage(message)],
      sectionId: sectionId || null,
    });

    const aiMessage = finalState.messages[finalState.messages.length - 1];

    return NextResponse.json({ reply: aiMessage.content });
  } catch (error) {
    console.error("Chat Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
