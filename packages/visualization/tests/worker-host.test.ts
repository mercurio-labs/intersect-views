import test from "node:test";
import assert from "node:assert/strict";
import { WorkerHost } from "../src/worker-host.ts";
class FakeWorker extends EventTarget {
  sent: any[] = [];
  terminated = false;
  throws = false;
  postMessage(value: unknown) {
    if (this.throws) throw new Error("post failed");
    this.sent.push(value);
  }
  terminate() {
    this.terminated = true;
  }
  reply(data: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
}
test("presentation transport binds focused requests and refuses mismatched response contexts", async () => {
  const w = new FakeWorker(), host = new WorkerHost(w as unknown as Worker), fingerprint = "a".repeat(64);
  const prepare = host.request("views/preparePresentation", {});
  w.reply({ id: 1, result: { presentation: { fingerprint } } }); await prepare;
  const target = host.request("views/targets", { revision: 3 });
  assert.equal(w.sent[1].params.presentationFingerprint, fingerprint);
  w.reply({ id: 2, result: { revision: 3, presentationFingerprint: fingerprint } });
  assert.deepEqual(await target, { revision: 3 });
  const stale = assert.rejects(host.request("views/prepare", {}), /Stale presentation/);
  w.reply({ id: 3, result: { presentationFingerprint: "b".repeat(64) } }); await stale;
  const scene = assert.rejects(host.request("views/scene", {}), /Stale presentation/);
  w.reply({ id: 4, result: { presentation: { fingerprint: "b".repeat(64) } } }); await scene;
  host.destroy();
});
test("worker clients correlate replies and keep language hosts isolated", async () => {
  const a = new FakeWorker(),
    b = new FakeWorker(),
    x = new WorkerHost(a as unknown as Worker),
    y = new WorkerHost(b as unknown as Worker);
  const first = x.request("initialize", { protocolVersion: 2 }),
    second = x.request("views/catalog", { revision: 1 });
  let otherDone = false;
  const other = y.request("initialize", { protocolVersion: 2 }).then((v) => {
    otherDone = true;
    return v;
  });
  a.reply({ id: 2, result: "catalog" });
  assert.equal(await second, "catalog");
  a.reply({ id: 1, result: "fmea" });
  assert.equal(await first, "fmea");
  assert.equal(otherDone, false);
  b.reply({ id: 1, result: "harness" });
  assert.equal(await other, "harness");
  a.reply({ id: 1, result: "late" });
  x.destroy();
  y.destroy();
});
test("worker destruction and failure reject pending and future requests", async () => {
  for (const event of ["destroy", "error"]) {
    const w = new FakeWorker(),
      h = new WorkerHost(w as unknown as Worker),
      pending = assert.rejects(
        h.request("workspace/analyze", {}),
        /closed|failed/,
      );
    if (event === "destroy") h.destroy();
    else w.dispatchEvent(new Event("error"));
    await pending;
    await assert.rejects(h.request("initialize", { protocolVersion: 2 }), /closed/);
    if (event === "destroy") assert.equal(w.terminated, true);
  }
});
test("posting and host errors reject without poisoning later correlation", async () => {
  const w = new FakeWorker(),
    h = new WorkerHost(w as unknown as Worker);
  w.throws = true;
  await assert.rejects(h.request("initialize", { protocolVersion: 2 }), /post failed/);
  w.throws = false;
  const rejected = assert.rejects(h.request("views/scene", {}), /stale/);
  w.reply({ id: 2, error: "stale revision" });
  await rejected;
  const accepted = h.request("initialize", { protocolVersion: 2 });
  w.reply({ id: 3, result: { language: "fmea" } });
  assert.deepEqual(await accepted, { language: "fmea" });
  h.destroy();
});
