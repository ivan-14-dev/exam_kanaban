import { supabase } from "@/lib/supabase/client";
import { parseTasks } from "@/lib/kanban";
import { mockKanbanTasks } from "@/lib/mock-data";
import type { KanbanTask } from "@/types";

const listeners = new Set<() => void>();
let snapshot: KanbanTask[] = mockKanbanTasks;
let initialized = false;

function notifyListeners() {
  for (const listener of listeners) listener();
}

function toRow(task: KanbanTask) {
  return {
    id: task.id,
    title: task.title,
    course_code: task.courseCode,
    due_date: task.dueDate,
    priority: task.priority,
    status: task.status,
    updated_at: new Date().toISOString(),
  };
}

function fromRow(row: Record<string, unknown>): KanbanTask | null {
  return parseTasks([
    {
      id: row.id,
      title: row.title,
      courseCode: row.course_code,
      dueDate: row.due_date,
      priority: row.priority,
      status: row.status,
    },
  ])?.[0] ?? null;
}

async function loadSharedTasks() {
  const { data, error } = await supabase
    .from("kanban_tasks")
    .select("id,title,course_code,due_date,priority,status")
    .order("updated_at", { ascending: true });

  if (error) return;
  const remoteTasks = (data ?? []).map((row) => fromRow(row)).filter((task): task is KanbanTask => Boolean(task));

  if (remoteTasks.length === 0) {
    await supabase.from("kanban_tasks").upsert(mockKanbanTasks.map(toRow), { onConflict: "id" });
    snapshot = mockKanbanTasks;
  } else {
    snapshot = remoteTasks;
  }
  initialized = true;
  notifyListeners();
}

if (typeof window !== "undefined") {
  void loadSharedTasks();
  supabase
    .channel("shared-kanban-tasks")
    .on("postgres_changes", { event: "*", schema: "public", table: "kanban_tasks" }, () => {
      void loadSharedTasks();
    })
    .subscribe();
}

export function subscribeToTasks(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getTasksSnapshot(): KanbanTask[] {
  return snapshot;
}

export function getTasksServerSnapshot(): KanbanTask[] {
  return mockKanbanTasks;
}

export function setTasks(update: (current: KanbanTask[]) => KanbanTask[]): void {
  const previousIds = new Set(snapshot.map((task) => task.id));
  snapshot = update(snapshot);
  notifyListeners();

  void (async () => {
    const nextIds = new Set(snapshot.map((task) => task.id));
    const removedIds = [...previousIds].filter((id) => !nextIds.has(id));
    if (removedIds.length) await supabase.from("kanban_tasks").delete().in("id", removedIds);
    if (snapshot.length) await supabase.from("kanban_tasks").upsert(snapshot.map(toRow), { onConflict: "id" });
  })();
}

export function resetTasks(): void {
  setTasks(() => mockKanbanTasks);
}

export function isTasksSyncReady(): boolean {
  return initialized;
}
