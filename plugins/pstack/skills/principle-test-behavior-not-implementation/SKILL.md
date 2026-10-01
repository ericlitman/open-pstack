---
name: principle-test-behavior-not-implementation
description: "Apply when you write, change, or keep a test. Call the code the way its users do and assert the observable result or contract. Check whether a relevant defect makes the test fail. Keep useful negative-path and relational contract tests."
user-invocable: false
---

# Test Behavior, Not Implementation

A test calls the code the way its users do and asserts the result or contract they observe. An assertion about internal calls or a copied constant can miss that behavior.

The check: before you keep a test, introduce a relevant defect and check that the test fails. Returning `undefined` can be a useful probe when a defined result is required. It does not invalidate a negative-path test whose correct result is absence or a relational contract check.

**Why:** A test that cannot fail for a defect costs CI time and review attention and catches nothing. A constant pin can obstruct harmless edits when the pinned value is not part of the contract.

**Five shapes that can miss the relevant behavior:**

- **Weak or no assertion.** No `expect`, or an assertion that checks too little of the contract. `toBeDefined`, `toBeTruthy`, `toBeInstanceOf`, and `toBeGreaterThan(0)` fail on `undefined`, but can accept a wrong defined result.
- **Mock or absence only.** Only checking that a mock was called can miss a wrong payload. Absence assertions such as `not.toThrow`, `not.toHaveBeenCalled`, `toBeUndefined`, `toEqual([])`, or `toHaveLength(0)` are useful when absence is the required behavior. Check that an incorrect presence or side effect fails the test.
- **Self-referential.** An expected value computed by the same faulty path can hide a defect: `expect(f(a)).toBe(f(a))`. Comparing two implementations can still test a required relation if the comparison detects relevant disagreement.
- **Constant pin.** Restating an incidental constant can block refactoring without testing behavior: `expect(LIMITS.maxTools).toBe(8)`. Keep prompt, configuration, and table checks that enforce a real contract.
- **Fixture asserts fixture.** The assertion reads data the test built, and the subject never runs. A subject called in `beforeEach` can still be tested if the assertion observes its result.

**The fix:** call the subject inside the test body with one concrete input and assert the literal output or the observable effect, `expect(slugify("Hello, World!")).toBe("hello-world")`. For an absence, exercise the negative path and prove that an incorrect presence or side effect fails. A separate positive-path test can provide contrast. For an incidental constant, test the mechanism that reads it. For a mock, assert the payload or observable state when those are the contract. Rewrite or delete a test only when it checks no relevant behavior or contract.

**Keep** a test of a relation across a table's rows (a key present in two tables, a parent that exists), and a compile-time check in a `*.test-d.ts` file.
