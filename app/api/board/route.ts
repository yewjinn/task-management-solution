type ListRow = {
  id: string;
  title: string;
  position: number;
  created_at: string;
  updated_at: string;
};

type CardRow = {
  id: string;
  task_number: number | null;
  list_id: string;
  title: string;
  notes: string;
  due_date: string | null;
  priority: string;
  effort: string;
  tags: string;
  position: number;
  completed: number;
  created_at: string;
  updated_at: string;
};

const DEFAULT_LISTS = ["Today", "Tomorrow", "This Week", "Later", "Done"];
const PRIORITIES = new Set(["none", "low", "medium", "high"]);
const EFFORTS = new Set(["small", "medium", "large"]);

async function database() {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("The task database is not available.");
  return env.DB;
}

let schemaReady: Promise<void> | null = null;

async function ensureSchema() {
  if (schemaReady) return schemaReady;
  const db = await database();
  schemaReady = db
    .batch([
      db.prepare(
        `CREATE TABLE IF NOT EXISTS board_settings (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL
        )`,
      ),
      db.prepare(
        `CREATE TABLE IF NOT EXISTS lists (
          id TEXT PRIMARY KEY NOT NULL,
          title TEXT NOT NULL,
          position INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`,
      ),
      db.prepare(
        `CREATE TABLE IF NOT EXISTS cards (
          id TEXT PRIMARY KEY NOT NULL,
          task_number INTEGER,
          list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          notes TEXT NOT NULL DEFAULT '',
          due_date TEXT,
          priority TEXT NOT NULL DEFAULT 'none',
          effort TEXT NOT NULL DEFAULT 'medium',
          tags TEXT NOT NULL DEFAULT '[]',
          position INTEGER NOT NULL,
          completed INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`,
      ),
      db.prepare("CREATE INDEX IF NOT EXISTS lists_position_idx ON lists (position)"),
      db.prepare(
        "CREATE INDEX IF NOT EXISTS cards_list_position_idx ON cards (list_id, position)",
      ),
      db.prepare("CREATE INDEX IF NOT EXISTS cards_due_date_idx ON cards (due_date)"),
    ])
    .then(async () => {
      const columns = await db.prepare("PRAGMA table_info(cards)").all<{
        name: string;
      }>();

      if (!columns.results.some((column) => column.name === "task_number")) {
        await db
          .prepare("ALTER TABLE cards ADD COLUMN task_number INTEGER")
          .run();
      }

      const maximum = await db
        .prepare("SELECT COALESCE(MAX(task_number), 0) AS value FROM cards")
        .first<{ value: number }>();
      let lastTaskNumber = Number(maximum?.value ?? 0);
      const unnumbered = await db
        .prepare(
          `SELECT id FROM cards
           WHERE task_number IS NULL
           ORDER BY created_at, id`,
        )
        .all<{ id: string }>();

      if (unnumbered.results.length) {
        await db.batch(
          unnumbered.results.map((card) =>
            db
              .prepare("UPDATE cards SET task_number = ? WHERE id = ?")
              .bind(++lastTaskNumber, card.id),
          ),
        );
      }

      await db
        .prepare(
          "CREATE UNIQUE INDEX IF NOT EXISTS cards_task_number_idx ON cards (task_number)",
        )
        .run();

      const sequence = await db
        .prepare("SELECT value FROM board_settings WHERE key = ?")
        .bind("last_task_number")
        .first<{ value: string }>();
      if (!sequence) {
        await db
          .prepare("INSERT INTO board_settings (key, value) VALUES (?, ?)")
          .bind("last_task_number", String(lastTaskNumber))
          .run();
      } else if (Number(sequence.value) < lastTaskNumber) {
        await db
          .prepare("UPDATE board_settings SET value = ? WHERE key = ?")
          .bind(String(lastTaskNumber), "last_task_number")
          .run();
      }
    })
    .catch((error) => {
      schemaReady = null;
      throw error;
    });
  return schemaReady;
}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function cleanOptionalDate(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function cleanTags(value: unknown) {
  const tags = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];

  return [...new Set(tags.map((tag) => cleanText(tag, 24)).filter(Boolean))].slice(
    0,
    8,
  );
}

function parseTags(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((tag) => typeof tag === "string") : [];
  } catch {
    return [];
  }
}

async function ensureInitialLists() {
  await ensureSchema();
  const db = await database();
  const seeded = await db
    .prepare("SELECT value FROM board_settings WHERE key = ?")
    .bind("initial_lists_seeded")
    .first<{ value: string }>();

  if (seeded) return;

  const count = await db.prepare("SELECT COUNT(*) AS count FROM lists").first<{
    count: number;
  }>();
  const now = new Date().toISOString();
  const statements = [];

  if (Number(count?.count ?? 0) === 0) {
    DEFAULT_LISTS.forEach((title, index) => {
      statements.push(
        db
          .prepare(
            "INSERT INTO lists (id, title, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
          )
          .bind(`list-${title.toLowerCase().replaceAll(" ", "-")}`, title, (index + 1) * 1000, now, now),
      );
    });
  }

  statements.push(
    db
      .prepare("INSERT INTO board_settings (key, value) VALUES (?, ?)")
      .bind("initial_lists_seeded", "true"),
  );
  await db.batch(statements);
}

async function readBoard() {
  await ensureInitialLists();
  const db = await database();
  const [listResult, cardResult] = await Promise.all([
    db
      .prepare(
        "SELECT id, title, position, created_at, updated_at FROM lists ORDER BY position, created_at",
      )
      .all<ListRow>(),
    db
      .prepare(
        `SELECT id, task_number, list_id, title, notes, due_date, priority, effort, tags,
                position, completed, created_at, updated_at
         FROM cards ORDER BY list_id, position, created_at`,
      )
      .all<CardRow>(),
  ]);

  const cardsByList = new Map<string, ReturnType<typeof presentCard>[]>();
  for (const card of cardResult.results) {
    const collection = cardsByList.get(card.list_id) ?? [];
    collection.push(presentCard(card));
    cardsByList.set(card.list_id, collection);
  }

  return {
    lists: listResult.results.map((list) => ({
      id: list.id,
      title: list.title,
      position: list.position,
      cards: cardsByList.get(list.id) ?? [],
    })),
  };
}

function presentCard(card: CardRow) {
  return {
    id: card.id,
    taskNumber: card.task_number,
    listId: card.list_id,
    title: card.title,
    notes: card.notes,
    dueDate: card.due_date,
    priority: card.priority,
    effort: card.effort,
    tags: parseTags(card.tags),
    position: card.position,
    completed: Boolean(card.completed),
    createdAt: card.created_at,
    updatedAt: card.updated_at,
  };
}

async function listExists(id: string) {
  const db = await database();
  return Boolean(
    await db
      .prepare("SELECT id FROM lists WHERE id = ?")
      .bind(id)
      .first<{ id: string }>(),
  );
}

async function maxPosition(table: "lists" | "cards", listId?: string) {
  const db = await database();
  const result = listId
    ? await db
        .prepare("SELECT COALESCE(MAX(position), 0) AS position FROM cards WHERE list_id = ?")
        .bind(listId)
        .first<{ position: number }>()
    : await db
        .prepare(`SELECT COALESCE(MAX(position), 0) AS position FROM ${table}`)
        .first<{ position: number }>();
  return Number(result?.position ?? 0);
}

async function nextTaskNumber() {
  const db = await database();
  const result = await db
    .prepare(
      `UPDATE board_settings
       SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
       WHERE key = ?
       RETURNING CAST(value AS INTEGER) AS value`,
    )
    .bind("last_task_number")
    .first<{ value: number }>();
  if (!result) throw new Error("A task number could not be assigned.");
  return Number(result.value);
}

async function handleAction(payload: Record<string, unknown>) {
  const db = await database();
  const action = cleanText(payload.action, 40);
  const now = new Date().toISOString();

  if (action === "createList") {
    const title = cleanText(payload.title, 80);
    if (!title) throw new Error("A list name is required.");
    await db
      .prepare(
        "INSERT INTO lists (id, title, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(crypto.randomUUID(), title, (await maxPosition("lists")) + 1000, now, now)
      .run();
    return;
  }

  if (action === "renameList") {
    const id = cleanText(payload.id, 80);
    const title = cleanText(payload.title, 80);
    if (!id || !title) throw new Error("A list and name are required.");
    await db
      .prepare("UPDATE lists SET title = ?, updated_at = ? WHERE id = ?")
      .bind(title, now, id)
      .run();
    return;
  }

  if (action === "deleteList") {
    const id = cleanText(payload.id, 80);
    if (!id) throw new Error("A list is required.");
    await db.prepare("DELETE FROM lists WHERE id = ?").bind(id).run();
    return;
  }

  if (action === "reorderLists") {
    const ids = Array.isArray(payload.ids)
      ? payload.ids.map((id) => cleanText(id, 80)).filter(Boolean)
      : [];
    if (!ids.length) return;
    await db.batch(
      ids.map((id, index) =>
        db
          .prepare("UPDATE lists SET position = ?, updated_at = ? WHERE id = ?")
          .bind((index + 1) * 1000, now, id),
      ),
    );
    return;
  }

  if (action === "createCard") {
    const listId = cleanText(payload.listId, 80);
    const title = cleanText(payload.title, 240);
    if (!listId || !(await listExists(listId))) throw new Error("Choose a valid list.");
    if (!title) throw new Error("A task title is required.");
    const list = await db
      .prepare("SELECT title FROM lists WHERE id = ?")
      .bind(listId)
      .first<{ title: string }>();
    await db
      .prepare(
        `INSERT INTO cards
          (id, task_number, list_id, title, notes, due_date, priority, effort, tags,
           position, completed, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        await nextTaskNumber(),
        listId,
        title,
        cleanText(payload.notes, 4000),
        cleanOptionalDate(payload.dueDate),
        PRIORITIES.has(String(payload.priority)) ? payload.priority : "none",
        EFFORTS.has(String(payload.effort)) ? payload.effort : "medium",
        JSON.stringify(cleanTags(payload.tags)),
        (await maxPosition("cards", listId)) + 1000,
        list?.title.toLowerCase() === "done" ? 1 : 0,
        now,
        now,
      )
      .run();
    return;
  }

  if (action === "updateCard") {
    const id = cleanText(payload.id, 80);
    const current = await db
      .prepare(
        `SELECT id, task_number, list_id, title, notes, due_date, priority, effort, tags,
                position, completed, created_at, updated_at
         FROM cards WHERE id = ?`,
      )
      .bind(id)
      .first<CardRow>();
    if (!current) throw new Error("That task no longer exists.");

    const listId = cleanText(payload.listId, 80) || current.list_id;
    if (!(await listExists(listId))) throw new Error("Choose a valid list.");
    const title = cleanText(payload.title, 240) || current.title;
    const destination = await db
      .prepare("SELECT title FROM lists WHERE id = ?")
      .bind(listId)
      .first<{ title: string }>();
    const listChanged = listId !== current.list_id;
    const completed =
      typeof payload.completed === "boolean"
        ? payload.completed
        : listChanged
          ? destination?.title.toLowerCase() === "done"
          : Boolean(current.completed);
    const position = listChanged
      ? (await maxPosition("cards", listId)) + 1000
      : current.position;
    const priority = PRIORITIES.has(String(payload.priority))
      ? String(payload.priority)
      : current.priority;
    const effort = EFFORTS.has(String(payload.effort))
      ? String(payload.effort)
      : current.effort;

    await db
      .prepare(
        `UPDATE cards SET list_id = ?, title = ?, notes = ?, due_date = ?,
          priority = ?, effort = ?, tags = ?, position = ?, completed = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        listId,
        title,
        typeof payload.notes === "string" ? cleanText(payload.notes, 4000) : current.notes,
        payload.dueDate === undefined ? current.due_date : cleanOptionalDate(payload.dueDate),
        priority,
        effort,
        payload.tags === undefined ? current.tags : JSON.stringify(cleanTags(payload.tags)),
        position,
        completed ? 1 : 0,
        now,
        id,
      )
      .run();
    return;
  }

  if (action === "deleteCard") {
    const id = cleanText(payload.id, 80);
    if (!id) throw new Error("A task is required.");
    await db.prepare("DELETE FROM cards WHERE id = ?").bind(id).run();
    return;
  }

  if (action === "reorderCards") {
    const columns = Array.isArray(payload.columns) ? payload.columns : [];
    const listsResult = await db.prepare("SELECT id, title FROM lists").all<{
      id: string;
      title: string;
    }>();
    const knownLists = new Map(
      listsResult.results.map((list) => [list.id, list.title.toLowerCase()]),
    );
    const statements = [];

    for (const column of columns) {
      if (!column || typeof column !== "object") continue;
      const listId = cleanText((column as { listId?: unknown }).listId, 80);
      const cardIds = Array.isArray((column as { cardIds?: unknown }).cardIds)
        ? (column as { cardIds: unknown[] }).cardIds
            .map((id) => cleanText(id, 80))
            .filter(Boolean)
        : [];
      if (!knownLists.has(listId)) continue;
      cardIds.forEach((cardId, index) => {
        statements.push(
          db
            .prepare(
              "UPDATE cards SET list_id = ?, position = ?, completed = ?, updated_at = ? WHERE id = ?",
            )
            .bind(
              listId,
              (index + 1) * 1000,
              knownLists.get(listId) === "done" ? 1 : 0,
              now,
              cardId,
            ),
        );
      });
    }
    if (statements.length) await db.batch(statements);
    return;
  }

  throw new Error("Unsupported board action.");
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  if (message.includes("no such table")) {
    return "The task database is still being prepared. Please try again shortly.";
  }
  return message;
}

export async function GET() {
  try {
    return Response.json(await readBoard());
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Record<string, unknown>;
    await ensureInitialLists();
    await handleAction(payload);
    return Response.json(await readBoard());
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 400 });
  }
}
