import { pgTable, text, varchar, timestamp, integer, uuid } from "drizzle-orm/pg-core";
import { vector } from "drizzle-orm/pg-core";

// Table to track books/documents
export const books = pgTable("books", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  author: varchar("author", { length: 255 }),
  filePath: text("file_path"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Hierarchical sections: Parts → Chapters → Sections → Subsections
export const structuralMetadata = pgTable("structural_metadata", {
  id: uuid("id").defaultRandom().primaryKey(),
  bookId: uuid("book_id").references(() => books.id, { onDelete: "cascade" }).notNull(),
  parentSectionId: uuid("parent_section_id"),
  title: varchar("title", { length: 255 }).notNull(),
  level: varchar("level", { length: 50 }).notNull(), // "part", "chapter", "section", "subsection"
  orderIndex: integer("order_index").notNull(),
  summary: text("summary"), // LLM-generated bullet-point key concepts
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Text chunks with embeddings for vector search
export const textChunks = pgTable("text_chunks", {
  id: uuid("id").defaultRandom().primaryKey(),
  sectionId: uuid("section_id").references(() => structuralMetadata.id, { onDelete: "cascade" }).notNull(),
  content: text("content").notNull(),
  orderIndex: integer("order_index").notNull().default(0),
  imageUrl: varchar("image_url", { length: 500 }),
  // intfloat/multilingual-e5-large-instruct via Together AI (1024 dimensions)
  embedding: vector("embedding", { dimensions: 1024 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Saved artifacts — bookmarked chat responses and user notes
export const savedArtifacts = pgTable("saved_artifacts", {
  id: uuid("id").defaultRandom().primaryKey(),
  sectionId: uuid("section_id").references(() => structuralMetadata.id, { onDelete: "set null" }),
  title: varchar("title", { length: 500 }).notNull(),
  content: text("content").notNull(),
  artifactType: varchar("artifact_type", { length: 50 }).notNull().default("chat_response"), // "chat_response" | "note"
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
