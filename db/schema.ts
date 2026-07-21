import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const boardSettings = sqliteTable("board_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const lists = sqliteTable(
  "lists",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    position: integer("position").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("lists_position_idx").on(table.position)],
);

export const cards = sqliteTable(
  "cards",
  {
    id: text("id").primaryKey(),
    taskNumber: integer("task_number"),
    listId: text("list_id")
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    notes: text("notes").notNull().default(""),
    dueDate: text("due_date"),
    priority: text("priority").notNull().default("none"),
    effort: text("effort").notNull().default("medium"),
    tags: text("tags").notNull().default("[]"),
    position: integer("position").notNull(),
    completed: integer("completed").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("cards_task_number_idx").on(table.taskNumber),
    index("cards_list_position_idx").on(table.listId, table.position),
    index("cards_due_date_idx").on(table.dueDate),
  ],
);
