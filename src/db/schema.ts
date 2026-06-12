import { pgTable, text, varchar, timestamp, integer, uuid, primaryKey } from "drizzle-orm/pg-core";
import { vector } from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

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

// ─── Auth tables (NextAuth / Auth.js Drizzle adapter) ─────────────────────────

export const users = pgTable("user", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
});

export const accounts = pgTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => [primaryKey({ columns: [account.provider, account.providerAccountId] })],
);

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })],
);

// ─── Saved artifacts ──────────────────────────────────────────────────────────

export const savedArtifacts = pgTable("saved_artifacts", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  sectionId: uuid("section_id").references(() => structuralMetadata.id, { onDelete: "set null" }),
  title: varchar("title", { length: 500 }).notNull(),
  content: text("content").notNull(),
  artifactType: varchar("artifact_type", { length: 50 }).notNull().default("chat_response"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
