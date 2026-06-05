import * as dotenv from "dotenv";
dotenv.config({ path: ".env" });

import { db } from "../src/db/index";
import { books, structuralMetadata } from "../src/db/schema";

// ---------------------------------------------------------------------------
// Deterministic Table of Contents for "Designing Data-Intensive Applications"
// by Martin Kleppmann (O'Reilly, 2017).
//
// This hierarchy is hardcoded — NOT LLM-discovered — so it is guaranteed to
// match the actual book structure. Summaries are left null; the ingestion
// script will populate them after matching parsed content to each section.
// ---------------------------------------------------------------------------

interface TocEntry {
  title: string;
  level: "part" | "chapter" | "section" | "subsection";
  children?: TocEntry[];
}

const TABLE_OF_CONTENTS: TocEntry[] = [
  // ── Part I ──────────────────────────────────────────────────────────────
  {
    title: "Foundations of Data Systems",
    level: "part",
    children: [
      {
        title: "Reliable, Scalable, and Maintainable Applications",
        level: "chapter",
        children: [
          { title: "Thinking About Data Systems", level: "section" },
          {
            title: "Reliability",
            level: "section",
          },
          {
            title: "Scalability",
            level: "section",
            children: [
              { title: "Describing Load", level: "subsection" },
              { title: "Describing Performance", level: "subsection" },
              { title: "Approaches to Coping with Load", level: "subsection" },
            ],
          },
          {
            title: "Maintainability",
            level: "section",
            children: [
              { title: "Operability", level: "subsection" },
              { title: "Simplicity", level: "subsection" },
              { title: "Evolvability", level: "subsection" },
            ],
          },
          { title: "Summary", level: "section" },
        ],
      },
      {
        title: "Data Models and Query Languages",
        level: "chapter",
        children: [
          {
            title: "Relational Model Versus Document Model",
            level: "section",
            children: [
              { title: "Birth of NoSQL", level: "subsection" },
              { title: "The Object-Relational Mismatch", level: "subsection" },
              { title: "Many-to-One and Many-to-Many Relationships", level: "subsection" },
              { title: "Are Document Databases Repeating History?", level: "subsection" },
              { title: "Relational Versus Document Databases Today", level: "subsection" },
            ],
          },
          {
            title: "Query Languages for Data",
            level: "section",
            children: [
              { title: "Declarative Queries on the Web", level: "subsection" },
              { title: "MapReduce Querying", level: "subsection" },
            ],
          },
          {
            title: "Graph-Like Data Models",
            level: "section",
            children: [
              { title: "Property Graphs", level: "subsection" },
              { title: "The Cypher Query Language", level: "subsection" },
              { title: "Graph Queries in SQL", level: "subsection" },
              { title: "Triple-Stores and SPARQL", level: "subsection" },
              { title: "The Foundation: Datalog", level: "subsection" },
            ],
          },
          { title: "Summary", level: "section" },
        ],
      },
      {
        title: "Storage and Retrieval",
        level: "chapter",
        children: [
          {
            title: "Data Structures That Power Your Database",
            level: "section",
            children: [
              { title: "Hash Indexes", level: "subsection" },
              { title: "SSTables and LSM-Trees", level: "subsection" },
              { title: "B-Trees", level: "subsection" },
              { title: "Comparing B-Trees and LSM-Trees", level: "subsection" },
              { title: "Other Indexing Structures", level: "subsection" },
            ],
          },
          {
            title: "Transaction Processing or Analytics?",
            level: "section",
            children: [
              { title: "Data Warehousing", level: "subsection" },
              { title: "Stars and Snowflakes: Schemas for Analytics", level: "subsection" },
            ],
          },
          {
            title: "Column-Oriented Storage",
            level: "section",
            children: [
              { title: "Column Compression", level: "subsection" },
              { title: "Sort Order in Column Storage", level: "subsection" },
              { title: "Writing to Column-Oriented Storage", level: "subsection" },
              { title: "Aggregation: Data Cubes and Materialized Views", level: "subsection" },
            ],
          },
          { title: "Summary", level: "section" },
        ],
      },
      {
        title: "Encoding and Evolution",
        level: "chapter",
        children: [
          {
            title: "Formats for Encoding Data",
            level: "section",
            children: [
              { title: "Language-Specific Formats", level: "subsection" },
              { title: "JSON XML and Binary Variants", level: "subsection" },
              { title: "Thrift and Protocol Buffers", level: "subsection" },
              { title: "Avro", level: "subsection" },
              { title: "The Merits of Schemas", level: "subsection" },
            ],
          },
          {
            title: "Modes of Dataflow",
            level: "section",
            children: [
              { title: "Dataflow Through Databases", level: "subsection" },
              { title: "Dataflow Through Services: REST and RPC", level: "subsection" },
              { title: "Message-Passing Dataflow", level: "subsection" },
            ],
          },
          { title: "Summary", level: "section" },
        ],
      },
    ],
  },

  // ── Part II ─────────────────────────────────────────────────────────────
  {
    title: "Distributed Data",
    level: "part",
    children: [
      {
        title: "Replication",
        level: "chapter",
        children: [
          {
            title: "Leaders and Followers",
            level: "section",
            children: [
              { title: "Synchronous Versus Asynchronous Replication", level: "subsection" },
              { title: "Setting Up New Followers", level: "subsection" },
              { title: "Handling Node Outages", level: "subsection" },
              { title: "Implementation of Replication Logs", level: "subsection" },
            ],
          },
          {
            title: "Problems with Replication Lag",
            level: "section",
            children: [
              { title: "Reading Your Own Writes", level: "subsection" },
              { title: "Monotonic Reads", level: "subsection" },
              { title: "Consistent Prefix Reads", level: "subsection" },
              { title: "Solutions for Replication Lag", level: "subsection" },
            ],
          },
          {
            title: "Multi-Leader Replication",
            level: "section",
            children: [
              { title: "Use Cases for Multi-Leader Replication", level: "subsection" },
              { title: "Handling Write Conflicts", level: "subsection" },
              { title: "Multi-Leader Replication Topologies", level: "subsection" },
            ],
          },
          {
            title: "Leaderless Replication",
            level: "section",
            children: [
              { title: "Writing to the Database When a Node Is Down", level: "subsection" },
              { title: "Limitations of Quorum Consistency", level: "subsection" },
              { title: "Sloppy Quorums and Hinted Handoff", level: "subsection" },
              { title: "Detecting Concurrent Writes", level: "subsection" },
            ],
          },
          { title: "Summary", level: "section" },
        ],
      },
      {
        title: "Partitioning",
        level: "chapter",
        children: [
          { title: "Partitioning and Replication", level: "section" },
          {
            title: "Partitioning of Key-Value Data",
            level: "section",
            children: [
              { title: "Partitioning by Key Range", level: "subsection" },
              { title: "Partitioning by Hash of Key", level: "subsection" },
              { title: "Skewed Workloads and Relieving Hot Spots", level: "subsection" },
            ],
          },
          {
            title: "Partitioning and Secondary Indexes",
            level: "section",
            children: [
              { title: "Partitioning Secondary Indexes by Document", level: "subsection" },
              { title: "Partitioning Secondary Indexes by Term", level: "subsection" },
            ],
          },
          {
            title: "Rebalancing Partitions",
            level: "section",
            children: [
              { title: "Strategies for Rebalancing", level: "subsection" },
              { title: "Operations: Automatic or Manual Rebalancing", level: "subsection" },
            ],
          },
          {
            title: "Request Routing",
            level: "section",
            children: [
              { title: "Parallel Query Execution", level: "subsection" },
            ],
          },
          { title: "Summary", level: "section" },
        ],
      },
      {
        title: "Transactions",
        level: "chapter",
        children: [
          {
            title: "The Slippery Concept of a Transaction",
            level: "section",
            children: [
              { title: "The Meaning of ACID", level: "subsection" },
              { title: "Single-Object and Multi-Object Operations", level: "subsection" },
            ],
          },
          {
            title: "Weak Isolation Levels",
            level: "section",
            children: [
              { title: "Read Committed", level: "subsection" },
              { title: "Snapshot Isolation and Repeatable Read", level: "subsection" },
              { title: "Preventing Lost Updates", level: "subsection" },
              { title: "Write Skew and Phantoms", level: "subsection" },
            ],
          },
          {
            title: "Serializability",
            level: "section",
            children: [
              { title: "Actual Serial Execution", level: "subsection" },
              { title: "Two-Phase Locking", level: "subsection" },
              { title: "Serializable Snapshot Isolation", level: "subsection" },
            ],
          },
          { title: "Summary", level: "section" },
        ],
      },
      {
        title: "The Trouble with Distributed Systems",
        level: "chapter",
        children: [
          {
            title: "Faults and Partial Failures",
            level: "section",
            children: [
              { title: "Cloud Computing and Supercomputing", level: "subsection" },
            ],
          },
          {
            title: "Unreliable Networks",
            level: "section",
            children: [
              { title: "Network Faults in Practice", level: "subsection" },
              { title: "Detecting Faults", level: "subsection" },
              { title: "Timeouts and Unbounded Delays", level: "subsection" },
              { title: "Synchronous Versus Asynchronous Networks", level: "subsection" },
            ],
          },
          {
            title: "Unreliable Clocks",
            level: "section",
            children: [
              { title: "Monotonic Versus Time-of-Day Clocks", level: "subsection" },
              { title: "Clock Synchronization and Accuracy", level: "subsection" },
              { title: "Relying on Synchronized Clocks", level: "subsection" },
              { title: "Process Pauses", level: "subsection" },
            ],
          },
          {
            title: "Knowledge Truth and Lies",
            level: "section",
            children: [
              { title: "The Truth Is Defined by the Majority", level: "subsection" },
              { title: "Byzantine Faults", level: "subsection" },
              { title: "System Model and Reality", level: "subsection" },
            ],
          },
          { title: "Summary", level: "section" },
        ],
      },
      {
        title: "Consistency and Consensus",
        level: "chapter",
        children: [
          { title: "Consistency Guarantees", level: "section" },
          {
            title: "Linearizability",
            level: "section",
            children: [
              { title: "What Makes a System Linearizable?", level: "subsection" },
              { title: "Relying on Linearizability", level: "subsection" },
              { title: "Implementing Linearizable Systems", level: "subsection" },
              { title: "The Cost of Linearizability", level: "subsection" },
            ],
          },
          {
            title: "Ordering Guarantees",
            level: "section",
            children: [
              { title: "Ordering and Causality", level: "subsection" },
              { title: "Sequence Number Ordering", level: "subsection" },
              { title: "Total Order Broadcast", level: "subsection" },
            ],
          },
          {
            title: "Distributed Transactions and Consensus",
            level: "section",
            children: [
              { title: "Atomic Commit and Two-Phase Commit", level: "subsection" },
              { title: "Distributed Transactions in Practice", level: "subsection" },
              { title: "Fault-Tolerant Consensus", level: "subsection" },
              { title: "Membership and Coordination Services", level: "subsection" },
            ],
          },
          { title: "Summary", level: "section" },
        ],
      },
    ],
  },

  // ── Part III ────────────────────────────────────────────────────────────
  {
    title: "Derived Data",
    level: "part",
    children: [
      {
        title: "Batch Processing",
        level: "chapter",
        children: [
          {
            title: "Batch Processing with Unix Tools",
            level: "section",
            children: [
              { title: "Simple Log Analysis", level: "subsection" },
              { title: "The Unix Philosophy", level: "subsection" },
            ],
          },
          {
            title: "MapReduce and Distributed Filesystems",
            level: "section",
            children: [
              { title: "MapReduce Job Execution", level: "subsection" },
              { title: "Reduce-Side Joins and Grouping", level: "subsection" },
              { title: "Map-Side Joins", level: "subsection" },
              { title: "The Output of Batch Workflows", level: "subsection" },
              { title: "Comparing Hadoop to Distributed Databases", level: "subsection" },
            ],
          },
          {
            title: "Beyond MapReduce",
            level: "section",
            children: [
              { title: "Materialization of Intermediate State", level: "subsection" },
              { title: "Graphs and Iterative Processing", level: "subsection" },
              { title: "High-Level APIs and Languages", level: "subsection" },
            ],
          },
          { title: "Summary", level: "section" },
        ],
      },
      {
        title: "Stream Processing",
        level: "chapter",
        children: [
          {
            title: "Transmitting Event Streams",
            level: "section",
            children: [
              { title: "Messaging Systems", level: "subsection" },
              { title: "Partitioned Logs", level: "subsection" },
            ],
          },
          {
            title: "Databases and Streams",
            level: "section",
            children: [
              { title: "Keeping Systems in Sync", level: "subsection" },
              { title: "Change Data Capture", level: "subsection" },
              { title: "Event Sourcing", level: "subsection" },
              { title: "State Streams and Immutability", level: "subsection" },
            ],
          },
          {
            title: "Processing Streams",
            level: "section",
            children: [
              { title: "Uses of Stream Processing", level: "subsection" },
              { title: "Reasoning About Time", level: "subsection" },
              { title: "Stream Joins", level: "subsection" },
              { title: "Fault Tolerance", level: "subsection" },
            ],
          },
          { title: "Summary", level: "section" },
        ],
      },
      {
        title: "The Future of Data Systems",
        level: "chapter",
        children: [
          {
            title: "Data Integration",
            level: "section",
            children: [
              { title: "Combining Specialized Tools by Deriving Data", level: "subsection" },
              { title: "Batch and Stream Processing", level: "subsection" },
            ],
          },
          {
            title: "Unbundling Databases",
            level: "section",
            children: [
              { title: "Composing Data Storage Technologies", level: "subsection" },
              { title: "Designing Applications Around Dataflow", level: "subsection" },
              { title: "Observing Derived State", level: "subsection" },
            ],
          },
          {
            title: "Aiming for Correctness",
            level: "section",
            children: [
              { title: "The End-to-End Argument for Databases", level: "subsection" },
              { title: "Enforcing Constraints", level: "subsection" },
              { title: "Timeliness and Integrity", level: "subsection" },
              { title: "Trust but Verify", level: "subsection" },
            ],
          },
          {
            title: "Doing the Right Thing",
            level: "section",
            children: [
              { title: "Predictive Analytics", level: "subsection" },
              { title: "Privacy and Tracking", level: "subsection" },
              { title: "Summary", level: "subsection" },
            ],
          },
        ],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Recursive insertion — walks the tree depth-first, using returning() to
// capture each row's generated UUID so children can reference it.
// ---------------------------------------------------------------------------

async function insertTocEntries(
  bookId: string,
  entries: TocEntry[],
  parentSectionId: string | null,
  startingOrderIndex: number,
): Promise<number> {
  let currentOrderIndex = startingOrderIndex;

  for (const entry of entries) {
    const [insertedRow] = await db
      .insert(structuralMetadata)
      .values({
        bookId,
        parentSectionId,
        title: entry.title,
        level: entry.level,
        orderIndex: currentOrderIndex,
        summary: null,
      })
      .returning();

    console.log(
      `  ${"  ".repeat(levelDepth(entry.level))}[${entry.level}] #${currentOrderIndex} — ${entry.title} (id: ${insertedRow.id.slice(0, 8)}…)`,
    );

    currentOrderIndex++;

    if (entry.children && entry.children.length > 0) {
      currentOrderIndex = await insertTocEntries(
        bookId,
        entry.children,
        insertedRow.id,
        currentOrderIndex,
      );
    }
  }

  return currentOrderIndex;
}

/** Indentation helper for console output */
function levelDepth(level: string): number {
  switch (level) {
    case "part":
      return 0;
    case "chapter":
      return 1;
    case "section":
      return 2;
    case "subsection":
      return 3;
    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  DDIA Table of Contents — Deterministic Seed               ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  // Step 1: Clear ALL existing data (cascade deletes structural_metadata + text_chunks)
  console.log("Clearing existing data (cascade delete from books)...");
  await db.delete(books);
  console.log("✓ All existing books, sections, and chunks deleted.\n");

  // Step 2: Insert the book record
  const pdfFilePath =
    "Martin-Kleppmann---Designing-Data-Intensive-Applications_-O\u2019Reilly-Media-(2017).pdf";

  const [insertedBook] = await db
    .insert(books)
    .values({
      title: "Designing Data-Intensive Applications",
      author: "Martin Kleppmann",
      filePath: pdfFilePath,
    })
    .returning();

  console.log(`✓ Book inserted: "${insertedBook.title}" (id: ${insertedBook.id})\n`);

  // Step 3: Recursively insert the full TOC hierarchy
  console.log("Inserting structural metadata...\n");
  const totalInserted = await insertTocEntries(
    insertedBook.id,
    TABLE_OF_CONTENTS,
    null,
    0,
  );

  console.log(`\n✓ Done! Inserted ${totalInserted} structural_metadata rows.`);
  console.log("  Summaries are null — run ingest-structured.ts to populate them.\n");

  process.exit(0);
}

main().catch((error) => {
  console.error("Fatal error during TOC seed:", error);
  process.exit(1);
});
