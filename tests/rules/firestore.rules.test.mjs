/**
 * The Firestore access rules, tested on Google's own rules engine (the emulator).
 *   npm run test:rules
 * Every login is <username>@lemsic-points.app and the username is the role.
 */
import { after, before, beforeEach, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from "firebase/firestore";

let env;
const as = (email) => env.authenticatedContext("uid-" + email, { email }).firestore();
const vpa = () => as("vpa@lemsic-points.app");
const aub = () => as("lo.aub@lemsic-points.app");
const usj = () => as("lo.usj@lemsic-points.app");
const draft = (lc, extra = {}) => ({ ref: "SUB-1", lc, title: "Screening", status: "draft", rows: [], ...extra });

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-lemsic",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
  });
});
after(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, "config/app"), { term: "Test term" });
    await setDoc(doc(db, "committees/AUB"), { code: "AUB", name: "AUB", active: true });
    await setDoc(doc(db, "rubric/oc_member"), { label: "OC member", def: 8, min: 6, max: 10 });
    await setDoc(doc(db, "members/m1"), { name: "Lea Khoury", lc: "AUB" });
    await setDoc(doc(db, "subs/lo.aub/items/pending1"), draft("AUB", { status: "pending" }));
    await setDoc(doc(db, "subs/lo.aub/items/returned1"), draft("AUB", { status: "returned", vpaNote: "Fix it" }));
    await setDoc(doc(db, "subs/lo.aub/items/draft1"), draft("AUB"));
    await setDoc(doc(db, "subs/lo.usj/items/theirs"), draft("USJ"));
    await setDoc(doc(db, "ledger/e1"), { memberId: "m1", pts: 8, kind: "award" });
    await setDoc(doc(db, "decisions/d1"), { total: 8 });
    await setDoc(doc(db, "audit/a1"), { action: "x" });
    await setDoc(doc(db, "imports/i1"), { filename: "old.xlsx", total: 463, status: "applied" });
  });
});

describe("who can see the reference data", () => {
  it("every officer reads the rubric, committees, members and term", async () => {
    for (const db of [vpa(), aub()]) {
      await assertSucceeds(getDocs(collection(db, "rubric")));
      await assertSucceeds(getDocs(collection(db, "committees")));
      await assertSucceeds(getDocs(collection(db, "members")));
      await assertSucceeds(getDoc(doc(db, "config/app")));
    }
  });
  it("a stranger, an outside email, or nobody signed in reads nothing", async () => {
    for (const db of [as("someone@gmail.com"), as("vpa@lemsic-points.app.evil.com"), env.unauthenticatedContext().firestore()]) {
      await assertFails(getDocs(collection(db, "rubric")));
      await assertFails(getDoc(doc(db, "config/app")));
    }
  });
  it("an account inside the domain but not a position reads nothing", async () => {
    await assertFails(getDocs(collection(as("treasurer@lemsic-points.app"), "rubric")));
  });
  it("a made-up LO login (someone signing themselves up) reads and writes nothing", async () => {
    for (const who of ["lo.xyz", "lo.aub2", "lo.", "lo.aub.x"]) {
      const db = as(who + "@lemsic-points.app");
      await assertFails(getDocs(collection(db, "members")));
      await assertFails(getDoc(doc(db, "config/app")));
      await assertFails(setDoc(doc(db, `subs/${who}/items/x`), draft(who.split(".")[1] || "X")));
      await assertFails(setDoc(doc(db, `subs/${who}`), { at: 1 }));
    }
  });
  it("each of the seven real LO logins is an LO", async () => {
    for (const code of ["aub", "usj", "lau", "bau", "lu", "uob", "usek"]) {
      const db = as(`lo.${code}@lemsic-points.app`);
      await assertSucceeds(getDocs(collection(db, "members")));
      await assertSucceeds(setDoc(doc(db, `subs/lo.${code}/items/new`), draft(code.toUpperCase())));
    }
  });
  it("only the VPA changes the rubric or the member list", async () => {
    await assertFails(setDoc(doc(aub(), "rubric/oc_member"), { label: "OC member", def: 99, min: 0, max: 99 }));
    await assertFails(setDoc(doc(aub(), "members/m2"), { name: "Ghost", lc: "AUB" }));
    await assertSucceeds(setDoc(doc(vpa(), "members/m2"), { name: "Real", lc: "AUB" }));
  });
});

describe("the points are the VPA's alone", () => {
  it("an LO cannot read the ledger, a single entry, the decisions or the audit log", async () => {
    await assertFails(getDocs(collection(aub(), "ledger")));
    await assertFails(getDoc(doc(aub(), "ledger/e1")));
    await assertFails(getDocs(collection(aub(), "decisions")));
    await assertFails(getDocs(collection(aub(), "audit")));
    await assertFails(getDocs(collection(aub(), "imports")));
    await assertFails(getDoc(doc(aub(), "settings/excel")));
    await assertFails(setDoc(doc(aub(), "settings/excel"), { itemId: "hijack" }));
  });
  it("the VPA keeps the record of imports, which can be marked undone but never deleted", async () => {
    await assertSucceeds(updateDoc(doc(vpa(), "imports/i1"), { status: "reversed" }));
    await assertFails(deleteDoc(doc(vpa(), "imports/i1")));
  });
  it("an LO cannot award points", async () => {
    await assertFails(setDoc(doc(aub(), "ledger/x"), { memberId: "m1", pts: 50, kind: "award" }));
  });
  it("the VPA reads and adds to the ledger", async () => {
    await assertSucceeds(getDocs(collection(vpa(), "ledger")));
    await assertSucceeds(setDoc(doc(vpa(), "ledger/e2"), { memberId: "m1", pts: -3, kind: "correction" }));
  });
  it("nobody, the VPA included, can change or delete a ledger entry", async () => {
    await assertFails(updateDoc(doc(vpa(), "ledger/e1"), { pts: 80 }));
    await assertFails(setDoc(doc(vpa(), "ledger/e1"), { memberId: "m1", pts: 80, kind: "award" }));
    await assertFails(deleteDoc(doc(vpa(), "ledger/e1")));
  });
  it("points must be a whole number", async () => {
    await assertFails(setDoc(doc(vpa(), "ledger/e3"), { memberId: "m1", pts: 2.5, kind: "award" }));
    await assertFails(setDoc(doc(vpa(), "ledger/e4"), { memberId: "m1", pts: "8", kind: "award" }));
  });
  it("audit entries can be added but never rewritten", async () => {
    await assertSucceeds(setDoc(doc(vpa(), "audit/a2"), { action: "y" }));
    await assertFails(updateDoc(doc(vpa(), "audit/a1"), { action: "rewritten" }));
    await assertFails(deleteDoc(doc(vpa(), "audit/a1")));
  });
});

describe("each LO works only on their own committee's submissions", () => {
  it("reads their own, never another committee's", async () => {
    await assertSucceeds(getDocs(collection(aub(), "subs/lo.aub/items")));
    await assertFails(getDocs(collection(aub(), "subs/lo.usj/items")));
    await assertFails(getDoc(doc(aub(), "subs/lo.usj/items/theirs")));
  });
  it("starts a draft for their own committee only, and only as a draft", async () => {
    await assertSucceeds(setDoc(doc(aub(), "subs/lo.aub/items/new1"), draft("AUB")));
    await assertFails(setDoc(doc(aub(), "subs/lo.aub/items/new2"), draft("USJ")));
    await assertFails(setDoc(doc(aub(), "subs/lo.aub/items/new3"), draft("AUB", { status: "approved" })));
    await assertFails(setDoc(doc(aub(), "subs/lo.usj/items/new4"), draft("AUB")));
  });
  it("edits and sends a draft, but cannot approve or return it", async () => {
    await assertSucceeds(updateDoc(doc(aub(), "subs/lo.aub/items/draft1"), { title: "Renamed" }));
    await assertFails(updateDoc(doc(aub(), "subs/lo.aub/items/draft1"), { status: "approved" }));
    await assertFails(updateDoc(doc(aub(), "subs/lo.aub/items/draft1"), { status: "returned" }));
    await assertSucceeds(updateDoc(doc(aub(), "subs/lo.aub/items/draft1"), { status: "pending" }));
  });
  it("cannot touch a submission once it is with the VPA", async () => {
    await assertFails(updateDoc(doc(aub(), "subs/lo.aub/items/pending1"), { title: "Sneaky edit" }));
    await assertFails(updateDoc(doc(aub(), "subs/lo.aub/items/pending1"), { status: "draft" }));
    await assertFails(deleteDoc(doc(aub(), "subs/lo.aub/items/pending1")));
  });
  it("fixes a returned submission and sends it again", async () => {
    await assertSucceeds(updateDoc(doc(aub(), "subs/lo.aub/items/returned1"), { title: "Fixed" }));
    await assertSucceeds(updateDoc(doc(aub(), "subs/lo.aub/items/returned1"), { status: "pending" }));
  });
  it("deletes their own draft, nothing else", async () => {
    await assertSucceeds(deleteDoc(doc(aub(), "subs/lo.aub/items/draft1")));
    await assertFails(deleteDoc(doc(usj(), "subs/lo.aub/items/returned1")));
  });
  it("cannot move a submission to another committee", async () => {
    await assertFails(updateDoc(doc(aub(), "subs/lo.aub/items/draft1"), { lc: "USJ" }));
  });
  it("the VPA approves and returns any of them", async () => {
    await assertSucceeds(updateDoc(doc(vpa(), "subs/lo.aub/items/pending1"), { status: "approved" }));
    await assertSucceeds(updateDoc(doc(vpa(), "subs/lo.usj/items/theirs"), { status: "returned", vpaNote: "No" }));
  });
});
