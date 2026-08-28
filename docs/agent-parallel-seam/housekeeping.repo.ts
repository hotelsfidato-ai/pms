import { queryKeys } from "./index";
import { rooms } from "@/data/fixtures/rooms";

/* ═════════════════════════════════════════════════════════════════
   HOUSEKEEPING REPOSITORY
   Rule 2: Screens import from here, never from fixtures directly.
   Every function takes hotelId first. Returns promises.
   Offline-first: mutations queue locally, sync when online.    ═════ */

export type RoomStatus = "clean" | "dirty" | "inspected" | "out-of-service";

export interface HousekeepingRoom {
  roomNumber: string;
  roomType: string;
  floor: number;
  status: RoomStatus;
  isOccupied: boolean;
  guestName?: string;
  priority: "normal" | "high" | "urgent";
  assignedTo?: string;
  lastCleaned?: string;
  notes?: string;
}

export interface HousekeepingTask {
  id: string;
  roomNumber: string;
  type: "clean" | "inspect" | "turnover" | "deep-clean";
  status: "pending" | "in-progress" | "done" | "deferred";
  priority: "normal" | "high" | "urgent";
  assignedTo?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  notes?: string;
  /** For offline queue */
  pendingSync?: boolean;
}

/* In-memory state with offline queue */
let roomStatuses: Map<string, RoomStatus> = new Map();
let tasks: HousekeepingTask[] = [];
let isOnline = true;
const offlineQueue: Array<() => Promise<void>> = [];

function initHousekeeping() {
  if (roomStatuses.size > 0) return;

  // Initialize from room fixtures
  for (const room of rooms) {
    // Room 308 is out-of-service
    if (room.number === "308") {
      roomStatuses.set(room.number, "out-of-service");
    } else {
      // Mix of statuses for demo
      const statuses: RoomStatus[] = ["clean", "dirty", "inspected"];
      roomStatuses.set(room.number, statuses[Math.floor(Math.random() * statuses.length)]);
    }
  }

  // Generate demo tasks
  const dirtyRooms = Array.from(roomStatuses.entries())
    .filter(([_, status]) => status === "dirty")
    .map(([roomNumber]) => roomNumber);

  for (const roomNumber of dirtyRooms.slice(0, 8)) {
    const room = rooms.find((r) => r.number === roomNumber);
    if (room) {
      tasks.push({
        id: `hk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        roomNumber,
        type: "clean",
        status: "pending",
        priority: room.floor === 3 ? "high" : "normal",
        createdAt: new Date(Date.now() - Math.random() * 3600000).toISOString(),
      });
    }
  }

  // Add some in-progress and done tasks
  for (const roomNumber of dirtyRooms.slice(8, 12)) {
    const room = rooms.find((r) => r.number === roomNumber);
    if (room) {
      tasks.push({
        id: `hk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        roomNumber,
        type: "clean",
        status: "in-progress",
        priority: "normal",
        assignedTo: "housekeeping-1",
        createdAt: new Date(Date.now() - Math.random() * 7200000).toISOString(),
        startedAt: new Date(Date.now() - Math.random() * 1800000).toISOString(),
      });
    }
  }

  for (const roomNumber of dirtyRooms.slice(12, 15)) {
    const room = rooms.find((r) => r.number === roomNumber);
    if (room) {
      tasks.push({
        id: `hk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        roomNumber,
        type: "clean",
        status: "done",
        priority: "normal",
        assignedTo: "housekeeping-2",
        createdAt: new Date(Date.now() - Math.random() * 10800000).toISOString(),
        startedAt: new Date(Date.now() - Math.random() * 5400000).toISOString(),
        completedAt: new Date(Date.now() - Math.random() * 1800000).toISOString(),
      });
    }
  }
}

export const housekeepingRepo = {
  /** Get all rooms with housekeeping status for a date */
  getRooms: async (hotelId: string, date: string): Promise<HousekeepingRoom[]> => {
    initHousekeeping();
    const result: HousekeepingRoom[] = [];

    for (const room of rooms) {
      if (room.hotelId !== hotelId) continue;

      const status = roomStatuses.get(room.number) ?? "clean";
      const task = tasks.find((t) => t.roomNumber === room.number && t.status !== "done");

      result.push({
        roomNumber: room.number,
        roomType: room.type,
        floor: room.floor,
        status,
        isOccupied: status !== "clean" && status !== "out-of-service",
        guestName: status === "dirty" ? `Guest in ${room.number}` : undefined,
        priority: task?.priority ?? "normal",
        assignedTo: task?.assignedTo,
        lastCleaned: task?.completedAt,
        notes: task?.notes,
      });
    }

    return result;
  },

  /** Get tasks for a date */
  getTasks: async (hotelId: string, date: string): Promise<HousekeepingTask[]> => {
    initHousekeeping();
    return tasks.filter((t) => t.status !== "done" || (t.completedAt && t.completedAt.startsWith(date)));
  },

  /** Get tasks assigned to a specific person */
  getMyTasks: async (hotelId: string, assignee: string, date: string): Promise<HousekeepingTask[]> => {
    initHousekeeping();
    return tasks.filter((t) => t.assignedTo === assignee && t.status !== "done");
  },

  /** Update room status */
  updateRoomStatus: async (hotelId: string, roomNumber: string, status: RoomStatus): Promise<void> => {
    initHousekeeping();

    const update = async () => {
      roomStatuses.set(roomNumber, status);

      // Update or create task
      const existingTask = tasks.find((t) => t.roomNumber === roomNumber && t.status !== "done");
      if (existingTask) {
        if (status === "clean" || status === "inspected") {
          existingTask.status = "done";
          existingTask.completedAt = new Date().toISOString();
        } else if (status === "dirty") {
          existingTask.status = "pending";
          existingTask.startedAt = undefined;
          existingTask.completedAt = undefined;
        }
      } else if (status === "dirty") {
        tasks.push({
          id: `hk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          roomNumber,
          type: "clean",
          status: "pending",
          priority: "normal",
          createdAt: new Date().toISOString(),
        });
      }
    };

    if (isOnline) {
      await update();
    } else {
      offlineQueue.push(update);
    }
  },

  /** Start a task */
  startTask: async (hotelId: string, taskId: string, assignee: string): Promise<HousekeepingTask | null> => {
    initHousekeeping();

    const update = async () => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return null;

      task.status = "in-progress";
      task.assignedTo = assignee;
      task.startedAt = new Date().toISOString();
      roomStatuses.set(task.roomNumber, "dirty");

      return task;
    };

    if (isOnline) {
      return update();
    } else {
      const promise = update();
      offlineQueue.push(async () => { await promise; });
      return promise;
    }
  },

  /** Complete a task */
  completeTask: async (hotelId: string, taskId: string, notes?: string): Promise<HousekeepingTask | null> => {
    initHousekeeping();

    const update = async () => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return null;

      task.status = "done";
      task.completedAt = new Date().toISOString();
      if (notes) task.notes = notes;
      roomStatuses.set(task.roomNumber, "clean");

      return task;
    };

    if (isOnline) {
      return update();
    } else {
      const promise = update();
      offlineQueue.push(async () => { await promise; });
      return promise;
    }
  },

  /** Defer a task */
  deferTask: async (hotelId: string, taskId: string, reason: string): Promise<HousekeepingTask | null> => {
    initHousekeeping();

    const update = async () => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return null;

      task.status = "deferred";
      task.notes = `Deferred: ${reason}`;

      return task;
    };

    if (isOnline) {
      return update();
    } else {
      const promise = update();
      offlineQueue.push(async () => { await promise; });
      return promise;
    }
  },

  /** Set online/offline status. Draining the queue is asynchronous, so
      this returns a promise the caller can await to know sync finished. */
  setOnline: async (online: boolean): Promise<void> => {
    isOnline = online;
    if (online && offlineQueue.length > 0) {
      const queue = [...offlineQueue];
      offlineQueue.length = 0;
      for (const fn of queue) {
        try {
          await fn();
        } catch {
          // Failed to sync, re-queue
          offlineQueue.push(fn);
        }
      }
    }
  },

  /** Get offline queue length */
  getOfflineQueueLength: (): number => offlineQueue.length,

  /** Get assignable rooms for a room type on a date */
  getAssignableRooms: async (hotelId: string, roomType: string, date: string): Promise<string[]> => {
    initHousekeeping();
    return rooms
      .filter((r) => r.hotelId === hotelId && r.type === roomType && r.number !== "308")
      .map((r) => r.number);
  },
};

/* TanStack Query helpers */

export const useHousekeepingRooms = (hotelId: string, date: string) => ({
  queryKey: queryKeys.housekeeping(hotelId, date),
  queryFn: () => housekeepingRepo.getRooms(hotelId, date),
});

export const useHousekeepingTasks = (hotelId: string, date: string) => ({
  queryKey: queryKeys.housekeeping(hotelId, date),
  queryFn: () => housekeepingRepo.getTasks(hotelId, date),
});

export const useAssignableRooms = (hotelId: string, roomType: string, date: string) => ({
  queryKey: queryKeys.assignableRooms(hotelId, roomType, date),
  queryFn: () => housekeepingRepo.getAssignableRooms(hotelId, roomType, date),
});