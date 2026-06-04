import { NextResponse } from "next/server";
import { ChatTogetherAI } from "@langchain/community/chat_models/togetherai";
import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import Together from "together-ai";
import { db } from "../../../db/index";
import { textChunks } from "../../../db/schema";
import { cosineDistance, desc, sql } from "drizzle-orm";

const together = new Together({
  apiKey: process.env.TOGETHER_API_KEY,
});

const llm = new ChatTogetherAI({
  model: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
  temperature: 0.1,
  maxTokens: 1024,
});

// Define LangGraph State
const StateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  context: Annotation<string>({
    reducer: (x, y) => y,
    default: () => "",
  }),
});

// Node 1: Retrieve context from Neon pgvector
async function retrieveNode(state: typeof StateAnnotation.State) {
  const messages = state.messages;
  const lastMessage = messages[messages.length - 1];
  const query = lastMessage.content.toString();

  // 1. Embed the query
  const embeddingsResponse = await together.embeddings.create({
    model: "intfloat/multilingual-e5-large-instruct",
    input: [query],
  });
  const vector = embeddingsResponse.data[0].embedding;

  // 2. Search Neon DB
  const similarity = sql<number>`1 - (${cosineDistance(textChunks.embedding, vector)})`;
  const results = await db
    .select({
      content: textChunks.content,
      similarity,
    })
    .from(textChunks)
    .orderBy(desc(similarity))
    .limit(5);

  const contextStr = results.map((r, i) => `[Document ${i+1}]:\n${r.content}`).join("\n\n");
  
  return { context: contextStr };
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

const app = workflow.compile();

export async function POST(req: Request) {
  try {
    const { message } = await req.json();

    if (!message) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    // Execute LangGraph
    const finalState = await app.invoke({
      messages: [new HumanMessage(message)],
    });

    const aiMessage = finalState.messages[finalState.messages.length - 1];

    return NextResponse.json({ reply: aiMessage.content });
  } catch (error) {
    console.error("Chat Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
