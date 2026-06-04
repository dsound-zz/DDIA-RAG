CREATE TABLE "books" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(255) NOT NULL,
	"author" varchar(255),
	"file_path" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "structural_metadata" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"parent_section_id" uuid,
	"title" varchar(255) NOT NULL,
	"level" varchar(50) NOT NULL,
	"order_index" integer NOT NULL,
	"summary" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "text_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section_id" uuid NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(768),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "structural_metadata" ADD CONSTRAINT "structural_metadata_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "text_chunks" ADD CONSTRAINT "text_chunks_section_id_structural_metadata_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."structural_metadata"("id") ON DELETE cascade ON UPDATE no action;