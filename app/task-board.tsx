"use client";

import {
  type DragEvent,
  type FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";

type Priority = "none" | "low" | "medium" | "high";
type Effort = "small" | "medium" | "large";

type TaskCard = {
  id: string;
  taskNumber: number;
  listId: string;
  title: string;
  notes: string;
  dueDate: string | null;
  priority: Priority;
  effort: Effort;
  tags: string[];
  position: number;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
};

type BoardList = {
  id: string;
  title: string;
  position: number;
  cards: TaskCard[];
};

type BoardState = { lists: BoardList[] };
type DragState =
  | { type: "list"; id: string }
  | { type: "card"; id: string; sourceListId: string }
  | null;

type CardDraft = {
  id?: string;
  listId: string;
  title: string;
  notes: string;
  dueDate: string;
  priority: Priority;
  effort: Effort;
  tags: string;
  completed: boolean;
};

const emptyBoard: BoardState = { lists: [] };

function singaporeDateKey(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function dueLabel(date: string | null) {
  if (!date) return null;
  if (date === singaporeDateKey()) return "Today";
  if (date === singaporeDateKey(1)) return "Tomorrow";
  return new Intl.DateTimeFormat("en-SG", {
    day: "numeric",
    month: "short",
  }).format(new Date(`${date}T00:00:00+08:00`));
}

function cardDueState(card: TaskCard) {
  if (!card.dueDate || card.completed) return "normal";
  if (card.dueDate < singaporeDateKey()) return "overdue";
  if (card.dueDate === singaporeDateKey()) return "today";
  return "normal";
}

function taskMatches(
  card: TaskCard,
  search: string,
  priority: string,
  effort: string,
  due: string,
) {
  const query = search.toLowerCase().trim();
  const haystack = [
    `task ${card.taskNumber}`,
    `task #${card.taskNumber}`,
    card.title,
    card.notes,
    ...card.tags,
  ]
    .join(" ")
    .toLowerCase();
  if (query && !haystack.includes(query)) return false;
  if (priority !== "all" && card.priority !== priority) return false;
  if (effort !== "all" && card.effort !== effort) return false;
  if (due === "overdue" && cardDueState(card) !== "overdue") return false;
  if (due === "today" && card.dueDate !== singaporeDateKey()) return false;
  if (due === "upcoming" && (!card.dueDate || card.dueDate <= singaporeDateKey()))
    return false;
  if (due === "none" && card.dueDate) return false;
  return true;
}

export default function TaskBoard() {
  const [board, setBoard] = useState<BoardState>(emptyBoard);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [quickTitle, setQuickTitle] = useState("");
  const [inlineTitles, setInlineTitles] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [effortFilter, setEffortFilter] = useState("all");
  const [dueFilter, setDueFilter] = useState("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [menuListId, setMenuListId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState>(null);
  const [cardDraft, setCardDraft] = useState<CardDraft | null>(null);
  const [listDialog, setListDialog] = useState<{
    mode: "create" | "rename";
    id?: string;
    title: string;
  } | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<{
    type: "list" | "card";
    id: string;
    title: string;
    count?: number;
  } | null>(null);

  async function loadBoard() {
    try {
      const response = await fetch("/api/board", { cache: "no-store" });
      const data = (await response.json()) as BoardState & { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not load the board.");
      setBoard(data);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the board.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    void fetch("/api/board", { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json()) as BoardState & { error?: string };
        if (!response.ok) throw new Error(data.error || "Could not load the board.");
        return data;
      })
      .then((data) => {
        if (!active) return;
        setBoard(data);
        setError("");
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : "Could not load the board.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function mutate(action: string, payload: Record<string, unknown> = {}) {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/board", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      const data = (await response.json()) as BoardState & { error?: string };
      if (!response.ok) throw new Error(data.error || "The change could not be saved.");
      setBoard(data);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The change could not be saved.");
      await loadBoard();
      return false;
    } finally {
      setSaving(false);
    }
  }

  const allCards = useMemo(
    () => board.lists.flatMap((list) => list.cards),
    [board.lists],
  );
  const openCards = allCards.filter((card) => !card.completed);
  const dueToday = openCards.filter((card) => card.dueDate === singaporeDateKey()).length;
  const overdue = openCards.filter((card) => cardDueState(card) === "overdue").length;
  const filtersActive =
    priorityFilter !== "all" || effortFilter !== "all" || dueFilter !== "all";
  const todayList =
    board.lists.find((list) => list.title.toLowerCase() === "today") ?? board.lists[0];

  async function addQuickTask(event: FormEvent) {
    event.preventDefault();
    if (!quickTitle.trim() || !todayList) return;
    const title = quickTitle;
    setQuickTitle("");
    const saved = await mutate("createCard", {
      listId: todayList.id,
      title,
      effort: "medium",
      priority: "none",
    });
    if (!saved) setQuickTitle(title);
  }

  async function addInlineTask(event: FormEvent, listId: string) {
    event.preventDefault();
    const title = inlineTitles[listId]?.trim();
    if (!title) return;
    setInlineTitles((current) => ({ ...current, [listId]: "" }));
    const saved = await mutate("createCard", { listId, title });
    if (!saved) setInlineTitles((current) => ({ ...current, [listId]: title }));
  }

  function openNewCard(listId: string) {
    setCardDraft({
      listId,
      title: "",
      notes: "",
      dueDate: "",
      priority: "none",
      effort: "medium",
      tags: "",
      completed: false,
    });
  }

  function openCard(card: TaskCard) {
    setCardDraft({
      id: card.id,
      listId: card.listId,
      title: card.title,
      notes: card.notes,
      dueDate: card.dueDate ?? "",
      priority: card.priority,
      effort: card.effort,
      tags: card.tags.join(", "),
      completed: card.completed,
    });
  }

  async function saveCard(event: FormEvent) {
    event.preventDefault();
    if (!cardDraft?.title.trim()) return;
    const action = cardDraft.id ? "updateCard" : "createCard";
    const saved = await mutate(action, {
      ...cardDraft,
      tags: cardDraft.tags.split(","),
    });
    if (saved) setCardDraft(null);
  }

  async function toggleComplete(card: TaskCard) {
    const doneList = board.lists.find((list) => list.title.toLowerCase() === "done");
    await mutate("updateCard", {
      ...card,
      listId: !card.completed && doneList ? doneList.id : card.listId,
      completed: !card.completed,
    });
  }

  async function saveList(event: FormEvent) {
    event.preventDefault();
    if (!listDialog?.title.trim()) return;
    const saved = await mutate(
      listDialog.mode === "create" ? "createList" : "renameList",
      { id: listDialog.id, title: listDialog.title },
    );
    if (saved) setListDialog(null);
  }

  async function confirmDelete() {
    if (!deleteDialog) return;
    const saved = await mutate(
      deleteDialog.type === "list" ? "deleteList" : "deleteCard",
      { id: deleteDialog.id },
    );
    if (saved) {
      setDeleteDialog(null);
      if (deleteDialog.type === "card") setCardDraft(null);
    }
  }

  function reorderListLocally(sourceId: string, targetId: string) {
    if (sourceId === targetId) return null;
    const next = [...board.lists];
    const sourceIndex = next.findIndex((list) => list.id === sourceId);
    const targetIndex = next.findIndex((list) => list.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return null;
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moved);
    const nextBoard = { lists: next };
    setBoard(nextBoard);
    return nextBoard;
  }

  async function persistListOrder(nextBoard: BoardState) {
    await mutate("reorderLists", { ids: nextBoard.lists.map((list) => list.id) });
  }

  async function moveListBy(id: string, delta: number) {
    const sourceIndex = board.lists.findIndex((list) => list.id === id);
    const target = board.lists[sourceIndex + delta];
    if (!target) return;
    const next = reorderListLocally(id, target.id);
    if (next) await persistListOrder(next);
    setMenuListId(null);
  }

  function moveCardLocally(cardId: string, targetListId: string, targetCardId?: string) {
    let movedCard: TaskCard | undefined;
    const lists = board.lists.map((list) => {
      const found = list.cards.find((card) => card.id === cardId);
      if (found) movedCard = { ...found, listId: targetListId };
      return { ...list, cards: list.cards.filter((card) => card.id !== cardId) };
    });
    if (!movedCard) return null;
    const next = lists.map((list) => {
      if (list.id !== targetListId) return list;
      const cards = [...list.cards];
      const targetIndex = targetCardId
        ? cards.findIndex((card) => card.id === targetCardId)
        : cards.length;
      cards.splice(targetIndex < 0 ? cards.length : targetIndex, 0, movedCard!);
      return { ...list, cards };
    });
    const nextBoard = { lists: next };
    setBoard(nextBoard);
    return nextBoard;
  }

  async function persistCardOrder(nextBoard: BoardState) {
    await mutate("reorderCards", {
      columns: nextBoard.lists.map((list) => ({
        listId: list.id,
        cardIds: list.cards.map((card) => card.id),
      })),
    });
  }

  async function dropOnList(event: DragEvent, targetListId: string) {
    event.preventDefault();
    event.stopPropagation();
    if (!dragState) return;
    if (dragState.type === "list") {
      const next = reorderListLocally(dragState.id, targetListId);
      setDragState(null);
      if (next) await persistListOrder(next);
      return;
    }
    const next = moveCardLocally(dragState.id, targetListId);
    setDragState(null);
    if (next) await persistCardOrder(next);
  }

  async function dropOnCard(
    event: DragEvent,
    targetListId: string,
    targetCardId: string,
  ) {
    event.preventDefault();
    event.stopPropagation();
    if (!dragState || dragState.type !== "card" || dragState.id === targetCardId)
      return;
    const next = moveCardLocally(dragState.id, targetListId, targetCardId);
    setDragState(null);
    if (next) await persistCardOrder(next);
  }

  if (loading) {
    return (
      <main className="app-shell loading-shell" aria-busy="true">
        <header className="topbar">
          <div className="brand-mark">✓</div>
          <div>
            <h1>My Work Board</h1>
            <p>Loading your work…</p>
          </div>
        </header>
        <div className="skeleton-toolbar" />
        <div className="skeleton-board">
          {Array.from({ length: 5 }).map((_, index) => (
            <div className="skeleton-column" key={index} />
          ))}
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-group">
          <div className="brand-mark" aria-hidden="true">✓</div>
          <div>
            <h1>My Work Board</h1>
            <p>
              {openCards.length} open
              {dueToday ? ` · ${dueToday} due today` : ""}
              {overdue ? ` · ${overdue} overdue` : ""}
            </p>
          </div>
        </div>
        <div className="save-state" aria-live="polite">
          <span className={saving ? "save-dot is-saving" : "save-dot"} />
          {saving ? "Saving…" : "Saved"}
        </div>
      </header>

      <section className="command-bar" aria-label="Board controls">
        <form className="quick-add" onSubmit={addQuickTask}>
          <span className="quick-plus" aria-hidden="true">+</span>
          <input
            value={quickTitle}
            onChange={(event) => setQuickTitle(event.target.value)}
            placeholder={todayList ? "What needs doing?" : "Add a list to get started"}
            aria-label="Add a task to Today"
            disabled={!todayList || saving}
          />
          <button type="submit" disabled={!quickTitle.trim() || !todayList || saving}>
            Add to {todayList?.title ?? "board"}
          </button>
        </form>
        <div className="board-tools">
          <label className="search-box">
            <span aria-hidden="true">⌕</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search tasks"
              aria-label="Search tasks"
            />
            {search && (
              <button type="button" onClick={() => setSearch("")} aria-label="Clear search">
                ×
              </button>
            )}
          </label>
          <button
            className={filtersActive ? "tool-button active" : "tool-button"}
            type="button"
            onClick={() => setFiltersOpen((open) => !open)}
            aria-expanded={filtersOpen}
          >
            Filter {filtersActive ? "•" : ""}
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={() => setListDialog({ mode: "create", title: "" })}
          >
            + Add list
          </button>
        </div>
      </section>

      {filtersOpen && (
        <section className="filter-strip" aria-label="Task filters">
          <label>
            Priority
            <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}>
              <option value="all">All priorities</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
              <option value="none">No priority</option>
            </select>
          </label>
          <label>
            Effort
            <select value={effortFilter} onChange={(event) => setEffortFilter(event.target.value)}>
              <option value="all">All effort</option>
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
            </select>
          </label>
          <label>
            Due
            <select value={dueFilter} onChange={(event) => setDueFilter(event.target.value)}>
              <option value="all">Any time</option>
              <option value="overdue">Overdue</option>
              <option value="today">Today</option>
              <option value="upcoming">Upcoming</option>
              <option value="none">No due date</option>
            </select>
          </label>
          {filtersActive && (
            <button
              type="button"
              className="clear-filter"
              onClick={() => {
                setPriorityFilter("all");
                setEffortFilter("all");
                setDueFilter("all");
              }}
            >
              Clear filters
            </button>
          )}
        </section>
      )}

      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void loadBoard()}>Try again</button>
        </div>
      )}

      {board.lists.length ? (
        <section className="board" aria-label="Task board">
          {board.lists.map((list, listIndex) => {
            const visibleCards = list.cards.filter((card) =>
              taskMatches(card, search, priorityFilter, effortFilter, dueFilter),
            );
            return (
              <article
                className={dragState?.type === "list" && dragState.id === list.id ? "list-column is-dragging" : "list-column"}
                key={list.id}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => void dropOnList(event, list.id)}
              >
                <header className="list-header">
                  <div className="list-title-row">
                    <button
                      className="drag-handle"
                      type="button"
                      draggable
                      aria-label={`Drag ${list.title} list`}
                      title="Drag to move list"
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        setDragState({ type: "list", id: list.id });
                      }}
                      onDragEnd={() => setDragState(null)}
                    >
                      ⠿
                    </button>
                    <h2>{list.title}</h2>
                    <span className="count-badge">{list.cards.length}</span>
                  </div>
                  <div className="list-menu-wrap">
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={`Options for ${list.title}`}
                      aria-expanded={menuListId === list.id}
                      onClick={() => setMenuListId(menuListId === list.id ? null : list.id)}
                    >
                      •••
                    </button>
                    {menuListId === list.id && (
                      <div className="popover-menu">
                        <button
                          type="button"
                          onClick={() => {
                            setListDialog({ mode: "rename", id: list.id, title: list.title });
                            setMenuListId(null);
                          }}
                        >
                          Rename list
                        </button>
                        <button type="button" disabled={listIndex === 0} onClick={() => void moveListBy(list.id, -1)}>
                          Move left
                        </button>
                        <button
                          type="button"
                          disabled={listIndex === board.lists.length - 1}
                          onClick={() => void moveListBy(list.id, 1)}
                        >
                          Move right
                        </button>
                        <button
                          className="danger-item"
                          type="button"
                          onClick={() => {
                            setDeleteDialog({ type: "list", id: list.id, title: list.title, count: list.cards.length });
                            setMenuListId(null);
                          }}
                        >
                          Delete list
                        </button>
                      </div>
                    )}
                  </div>
                </header>

                <div className="card-stack">
                  {visibleCards.map((card) => {
                    const dueState = cardDueState(card);
                    return (
                      <article
                        className={`task-card ${card.completed ? "is-complete" : ""} ${dueState === "overdue" ? "is-overdue" : ""}`}
                        key={card.id}
                        draggable
                        onDragStart={(event) => {
                          event.stopPropagation();
                          event.dataTransfer.effectAllowed = "move";
                          setDragState({ type: "card", id: card.id, sourceListId: list.id });
                        }}
                        onDragEnd={() => setDragState(null)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => void dropOnCard(event, list.id, card.id)}
                        onClick={() => openCard(card)}
                      >
                        <span className="task-number">Task #{card.taskNumber}</span>
                        <div className="card-topline">
                          <button
                            className={card.completed ? "complete-button checked" : "complete-button"}
                            type="button"
                            aria-label={card.completed ? `Mark ${card.title} incomplete` : `Complete ${card.title}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              void toggleComplete(card);
                            }}
                          >
                            {card.completed ? "✓" : ""}
                          </button>
                          <h3>{card.title}</h3>
                        </div>
                        {card.notes && <p className="card-note">{card.notes}</p>}
                        {card.tags.length > 0 && (
                          <div className="tag-row">
                            {card.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}
                            {card.tags.length > 3 && <span>+{card.tags.length - 3}</span>}
                          </div>
                        )}
                        <div className="card-meta">
                          <div className="meta-left">
                            {card.dueDate && (
                              <span className={`due-label ${dueState}`}>
                                {dueState === "overdue" ? "Overdue · " : ""}{dueLabel(card.dueDate)}
                              </span>
                            )}
                            <span className="effort-label" title={`${card.effort} effort`}>
                              {card.effort === "small" ? "S" : card.effort === "large" ? "L" : "M"}
                            </span>
                          </div>
                          {card.priority !== "none" && <span className={`priority-badge ${card.priority}`}>{card.priority}</span>}
                        </div>
                      </article>
                    );
                  })}
                  {!visibleCards.length && (
                    <div className="empty-list">
                      {list.cards.length ? "No matching tasks" : list.title.toLowerCase() === "done" ? "Completed tasks land here" : "Nothing here yet"}
                    </div>
                  )}
                </div>

                <form className="inline-add" onSubmit={(event) => void addInlineTask(event, list.id)}>
                  <input
                    value={inlineTitles[list.id] ?? ""}
                    onChange={(event) => setInlineTitles((current) => ({ ...current, [list.id]: event.target.value }))}
                    placeholder="Add a task"
                    aria-label={`Add a task to ${list.title}`}
                  />
                  <button type="submit" aria-label={`Add task to ${list.title}`} disabled={!inlineTitles[list.id]?.trim() || saving}>+</button>
                  <button type="button" className="detail-add" onClick={() => openNewCard(list.id)}>Details</button>
                </form>
              </article>
            );
          })}
        </section>
      ) : (
        <section className="empty-board">
          <div className="empty-icon">✓</div>
          <h2>Start with your first list</h2>
          <p>Create a time horizon or workflow stage, then add tasks as they arrive.</p>
          <button className="primary-button" type="button" onClick={() => setListDialog({ mode: "create", title: "" })}>+ Add a list</button>
        </section>
      )}

      {cardDraft && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setCardDraft(null)}>
          <section className="modal card-modal" role="dialog" aria-modal="true" aria-labelledby="card-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <span className="eyebrow">
                  {cardDraft.id
                    ? `Task #${allCards.find((card) => card.id === cardDraft.id)?.taskNumber ?? ""}`
                    : "New task"}
                </span>
                <h2 id="card-dialog-title">{cardDraft.id ? "Edit task" : "Add a task"}</h2>
              </div>
              <button type="button" className="close-button" onClick={() => setCardDraft(null)} aria-label="Close">×</button>
            </div>
            <form onSubmit={(event) => void saveCard(event)}>
              <label className="field field-wide">
                Task
                <input autoFocus value={cardDraft.title} onChange={(event) => setCardDraft({ ...cardDraft, title: event.target.value })} placeholder="What needs doing?" maxLength={240} required />
              </label>
              <label className="field field-wide">
                Notes
                <textarea value={cardDraft.notes} onChange={(event) => setCardDraft({ ...cardDraft, notes: event.target.value })} placeholder="Context, next step, or useful links" rows={4} maxLength={4000} />
              </label>
              <div className="field-grid">
                <label className="field">
                  List
                  <select value={cardDraft.listId} onChange={(event) => setCardDraft({ ...cardDraft, listId: event.target.value })}>
                    {board.lists.map((list) => <option key={list.id} value={list.id}>{list.title}</option>)}
                  </select>
                </label>
                <label className="field">
                  Due date
                  <input type="date" value={cardDraft.dueDate} onChange={(event) => setCardDraft({ ...cardDraft, dueDate: event.target.value })} />
                </label>
                <label className="field">
                  Priority
                  <select value={cardDraft.priority} onChange={(event) => setCardDraft({ ...cardDraft, priority: event.target.value as Priority })}>
                    <option value="none">None</option>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </label>
                <label className="field">
                  Effort
                  <select value={cardDraft.effort} onChange={(event) => setCardDraft({ ...cardDraft, effort: event.target.value as Effort })}>
                    <option value="small">Small</option>
                    <option value="medium">Medium</option>
                    <option value="large">Large</option>
                  </select>
                </label>
              </div>
              <label className="field field-wide">
                Tags
                <input value={cardDraft.tags} onChange={(event) => setCardDraft({ ...cardDraft, tags: event.target.value })} placeholder="client, finance, follow-up" />
                <small>Separate tags with commas.</small>
              </label>
              {cardDraft.id && (
                <label className="complete-toggle">
                  <input type="checkbox" checked={cardDraft.completed} onChange={(event) => setCardDraft({ ...cardDraft, completed: event.target.checked })} />
                  Task is complete
                </label>
              )}
              <div className="modal-actions">
                {cardDraft.id && (
                  <button className="danger-button" type="button" onClick={() => setDeleteDialog({ type: "card", id: cardDraft.id!, title: cardDraft.title })}>Delete</button>
                )}
                <span className="action-spacer" />
                <button className="secondary-button" type="button" onClick={() => setCardDraft(null)}>Cancel</button>
                <button className="primary-button" type="submit" disabled={!cardDraft.title.trim() || saving}>{saving ? "Saving…" : "Save task"}</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {listDialog && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setListDialog(null)}>
          <section className="modal small-modal" role="dialog" aria-modal="true" aria-labelledby="list-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <span className="eyebrow">Board structure</span>
                <h2 id="list-dialog-title">{listDialog.mode === "create" ? "Add a list" : "Rename list"}</h2>
              </div>
              <button type="button" className="close-button" onClick={() => setListDialog(null)} aria-label="Close">×</button>
            </div>
            <form onSubmit={(event) => void saveList(event)}>
              <label className="field field-wide">
                List name
                <input autoFocus value={listDialog.title} onChange={(event) => setListDialog({ ...listDialog, title: event.target.value })} placeholder="e.g. Waiting" maxLength={80} required />
              </label>
              <div className="modal-actions">
                <span className="action-spacer" />
                <button className="secondary-button" type="button" onClick={() => setListDialog(null)}>Cancel</button>
                <button className="primary-button" type="submit" disabled={!listDialog.title.trim() || saving}>{listDialog.mode === "create" ? "Add list" : "Save name"}</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {deleteDialog && (
        <div className="modal-backdrop delete-layer" role="presentation" onMouseDown={() => setDeleteDialog(null)}>
          <section className="modal small-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <span className="eyebrow danger-text">Permanent action</span>
                <h2 id="delete-dialog-title">Delete “{deleteDialog.title}”?</h2>
              </div>
              <button type="button" className="close-button" onClick={() => setDeleteDialog(null)} aria-label="Close">×</button>
            </div>
            <p className="delete-copy">
              {deleteDialog.type === "list" && deleteDialog.count
                ? `This will also delete ${deleteDialog.count} task${deleteDialog.count === 1 ? "" : "s"} in the list.`
                : "This cannot be undone."}
            </p>
            <div className="modal-actions">
              <span className="action-spacer" />
              <button className="secondary-button" type="button" onClick={() => setDeleteDialog(null)}>Cancel</button>
              <button className="danger-button solid" type="button" onClick={() => void confirmDelete()} disabled={saving}>{saving ? "Deleting…" : "Delete"}</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
