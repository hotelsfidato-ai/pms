import * as ops from "./operations";
import * as rooms from "./rooms";

/* Object surface over ./operations and ./rooms. The rules that permit
   a room to be marked clean or inspected live in src/lib/rules.ts. */

export const housekeepingRepo = {
  list: ops.listHousekeeping,
  mark: ops.markRoom,
  updateRoomStatus: rooms.setHousekeeping,
  listRooms: rooms.listAllRooms,
};
