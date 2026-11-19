import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generatePassword } from "../src/auth/passwords.js";
import { clearAttempts, isLimited, recordFailure } from "../src/auth/rate-limit.js";
import { timeAgo, waitedFor } from "../src/lib/text.js";

describe("one-time passwords", () => {
  it("are three words and four digits, easy to read aloud", () => {
    for (let i = 0; i < 50; i++) assert.match(generatePassword(), /^[a-z]+-[a-z]+-[a-z]+-\d{4}$/);
  });

  it("do not repeat across a term's worth of accounts", () => {
    const issued = new Set(Array.from({ length: 500 }, generatePassword));
    assert.equal(issued.size, 500);
  });
});

describe("sign-in limiter", () => {
  it("lets nine wrong guesses through and stops the tenth", () => {
    const key = `user:test-${Math.random()}`;
    for (let i = 0; i < 9; i++) { assert.equal(isLimited(key, 10), false); recordFailure(key); }
    assert.equal(isLimited(key, 10), false, "nine failures is still under the limit");
    recordFailure(key);
    assert.equal(isLimited(key, 10), true);
  });

  it("forgets a username's failures once they get in", () => {
    const key = `user:test-${Math.random()}`;
    for (let i = 0; i < 10; i++) recordFailure(key);
    clearAttempts(key);
    assert.equal(isLimited(key, 10), false);
  });

  it("keeps one person's typos from locking out another", () => {
    const a = `user:a-${Math.random()}`;
    const b = `user:b-${Math.random()}`;
    for (let i = 0; i < 10; i++) recordFailure(a);
    assert.equal(isLimited(b, 10), false);
  });
});

describe("relative times", () => {
  const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);
  it("reads as a moment where a moment is meant", () => {
    assert.equal(timeAgo(new Date()), "just now");
    assert.equal(timeAgo(minutesAgo(5)), "5 min ago");
    assert.equal(timeAgo(minutesAgo(60 * 26)), "1 day ago");
  });
  it("reads as a span where a wait is meant", () => {
    assert.equal(waitedFor(new Date()), "under a minute");
    assert.equal(waitedFor(minutesAgo(60 * 3)), "3 hours");
    assert.equal(waitedFor(minutesAgo(60 * 24 * 6)), "6 days");
  });
});
