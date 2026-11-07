/* Who reads Guest feedback and gets a low answer in Notifications (D27-383
   item 10, decided under D27-396): the owner, an administrator and the GM.
   ONE list: the server's route and bell, and the website's menu, import this
   file (it imports nothing, so the website can bundle it). */
export const FEEDBACK_ROLES: readonly string[] = ["owner", "admin", "gm"];
