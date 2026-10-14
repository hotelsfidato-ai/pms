// Film 1 "Setting up a hotel" (F1): the recordings, on the LOCAL demo only.
// A brand-new, non-test hotel (PHN, Practice Hotel Nashik) is made with Add a property and
// taken through the Set up this hotel wizard. One run, in order: each shot carries on from
// the one before unless it has an address. Used only by video's tools/record.mjs (these are
// recordings, not manual pictures). Run in groups with --only= (the data builds up).
// The provisioning key is read from the git-ignored local file at run time; it is typed into
// a password box (dots) and never printed.
import { readFileSync } from "node:fs";

const KEY = readFileSync("D:/fidato pms/.local/lanes/local-provisioning-key.txt", "utf8")
  .split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith("#"));
const W = (step) => `/settings/property/set-up-this-hotel?step=${step}`;
const OWNER = "Owner";
const BACK = [{ click: "text:Back to setup" }, { wait: 1200 }];
const TOAST = "css:[role=region] [role=status]";

export const SHOTS = [
  /* ── F1-01: a new hotel, and the Set up this hotel page ───────────── */
  { id: "F1-01a", as: OWNER, path: "/properties", steps: [
    { scroll: "text:Add a property" },
    { type: ["css:input[placeholder='NSK']", "PHN"] },
    { type: ["css:input[placeholder=\"The property's name\"]", "Practice Hotel Nashik"] },
    { type: ["css:input[placeholder='Nashik']", "Nashik"] },
    { type: ["css:input[placeholder='MH']", "MH"] },
    { type: ["css:input[placeholder='the provisioning key']", KEY] },
    { wait: 1500 },
  ] },
  { id: "F1-01b", steps: [
    { click: "text:Create the property" },
    { wait: 4000 },
    { scroll: "text:Practice Hotel Nashik" },
    { wait: 1500 },
  ] },
  { id: "F1-01b2", title: "reload, so the account menu knows the new hotel", as: OWNER, path: "/properties" },
  /* a later group starts here: signed in, with the film hotel chosen (unrecorded) */
  { id: "F1-PICK", title: "choose PHN", as: OWNER, path: "/properties",
    steps: [{ eval: "localStorage.setItem('fidato.ui', JSON.stringify({ state: { hotelId: 'PHN', sidebarCollapsed: false }, version: 0 }))" }] },
  { id: "F1-01c", steps: [
    { click: "label:Account and property" },
    { wait: 1500 },
    { click: "text:PHN · Nashik" },
    { wait: 2500 },
  ] },
  { id: "F1-01d", path: "/settings/property/profile", steps: [
    { wait: 3000 },
    { scroll: "text:Set up this hotel, step by step" },
    { wait: 2500 },
    { scroll: "text:Set up this hotel", nth: 1 },
    { wait: 3000 },
  ] },
  { id: "F1-01e", steps: [
    { click: "text:Set up this hotel, step by step" },
    { waitFor: "text:Ready to go live" },
    { wait: 1500 },
    { eval: "window.scrollTo({top: document.body.scrollHeight, behavior:'smooth'}); document.querySelectorAll('main, [class*=overflow-y]').forEach(e=>e.scrollTo&&e.scrollTo({top:e.scrollHeight,behavior:'smooth'}))" },
    { wait: 6000 },
  ] },
  { id: "F1-01f", path: W("profile"), steps: [
    { wait: 2500 },
    { scroll: "text:What is missing" },
    { wait: 3000 },
    { scroll: "text:Open Profile" },
    { wait: 5000 },
  ] },
];
