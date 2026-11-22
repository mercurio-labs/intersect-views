import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ViewSession,
  CommandRejection,
  bufferHash,
  type HostClient,
} from "../src/session.ts";
const response = JSON.parse(
  readFileSync(
    new URL(
      "../../../crates/intersect-views/tests/fixtures/scene-harness-v6-m14.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
async function fixture(mode = "success", grid = false) {
  const graphResponse = response;
  const active = JSON.parse(
    readFileSync(
      new URL(
        "../../../crates/intersect-views/tests/fixtures/grid-v7-accepted-m14.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ).find((c: any) => c.name === "matrix").value;
  const currentResponse = grid
    ? {
        scene: active,
        capabilities: [{ toolId: "select", enabled: true, reason: "" }],
      }
    : graphResponse;

  let text = "alpha",
    revision = 1,
    reserved = 1,
    undo = 0,
    applied = 0,
    published = 0,
    aborted = 0,
    sceneCount = 0,
    highlight: string | null = null;
  const prepared = {
    schemaVersion: 1,
    token: "edit:1:1",
    baseRevision: 1,
    nextRevision: 2,
    patches: [
      {
        uri: "a.harness",
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 5 },
        },
        original: "alpha",
        replacement: "beta",
        beforeHash: await bufferHash("alpha"),
        afterHash: await bufferHash("beta"),
      },
    ],
    created: "",
  };
  if (mode === "hash") prepared.patches[0].beforeHash = "0".repeat(64);
  const buffers = {
    read: () => text,
    sources: () => [{ uri: "a.harness", text }],
    apply() {
      text = "beta";
      applied++;
    },
    undo() {
      if (mode === "rollback") throw Error("undo failed");
      text = "alpha";
      undo++;
    },
    revision: () => revision,
    reserveRevision(n: number) {
      reserved = n;
    },
    publish(analysis: any) {
      revision = analysis.revision;
      published++;
    },
  };
  const host: HostClient = {
    async request<T>(method: string): Promise<T> {
      if (method === "views/prepareCommand") {
        if (mode === "rejection")
          return {
            code: "harness.names.unique",
            message: "Names must be unique",
            feature: "name",
            elementKey: "owner",
          } as T;
        if (mode === "stale") revision = 3;
        return structuredClone(prepared) as T;
      }
      if (method === "views/commitCommand") {
        if (mode === "typing") {
          text = "beta typed";
          revision = reserved + 1;
          throw new Error("commit raced typing");
        }
        if (mode === "fail" || mode === "rollback")
          throw new Error("commit failed");
        return { revision: 2, clean: true } as T;
      }
      if (method === "views/abortCommand") {
        aborted++;
        return {} as T;
      }
      if (method === "views/catalog")
        return { revision, views: [currentResponse.scene.view] } as T;
      if (method === "views/locate") return { elementId: "located" } as T;
      const scene = structuredClone(currentResponse);
      scene.scene.revision = revision;
      return scene as T;
    },
  };
  const surface = {
    views() {},
    requestView() {},
    setScene() {
      sceneCount++;
    },
    setStale() {},
    status() {},
    highlight(id: string | null) {
      highlight = id;
    },
  };
  const session = new ViewSession(host, buffers, surface);
  session.setAnalysis({ revision: 1, clean: true });
  session.selectedView = currentResponse.scene.view.key;
  return {
    session,
    buffers,
    get state() {
      return {
        text,
        revision,
        reserved,
        undo,
        applied,
        published,
        aborted,
        sceneCount,
        highlight,
      };
    },
  };
}
test("session commits one undo group and refreshes the accepted revision", async () => {
  const f = await fixture();
  await f.session.command("create", "owner", {});
  assert.equal(f.state.text, "beta");
  assert.equal(f.state.applied, 1);
  assert.equal(f.state.undo, 0);
  assert.equal(f.state.published, 1);
  assert.equal(f.state.sceneCount, 1);
  await f.session.cursor("a.harness", 0, 0);
  assert.equal(f.state.highlight, "located");
});
for (const mode of ["stale", "hash", "fail", "typing"])
  test(`session refuses ${mode} and rolls back only its own current buffers`, async () => {
    const f = await fixture(mode);
    await assert.rejects(f.session.command("create", "owner", {}));
    assert.equal(f.state.published, 0);
    assert.equal(f.state.aborted, 1);
    assert.equal(f.state.undo, mode === "fail" ? 1 : 0);
    assert.equal(f.state.text, mode === "typing" ? "beta typed" : "alpha");
  });
test("a late catalog response cannot publish after invalidation", async () => {
  let resolve!: (value: any) => void,
    published = 0;
  const host = {
    request: () => new Promise((r) => (resolve = r)),
  } as HostClient;
  const buffers = { revision: () => 1 } as any;
  const surface = {
    setStale() {},
    views() {
      published++;
    },
  } as any;
  const session = new ViewSession(host, buffers, surface);
  session.setAnalysis({ revision: 1, clean: true });
  const pending = session.refresh();
  session.invalidate();
  resolve({ revision: 1, views: [response.scene.view] });
  await pending;
  assert.equal(published, 0);
});
test("structured prepare rejection reaches the UI without applying or aborting an absent token", async () => {
  const f = await fixture("rejection");
  await assert.rejects(
    f.session.command("box", "owner", {}),
    (error: unknown) =>
      error instanceof CommandRejection &&
      error.code === "harness.names.unique" &&
      error.feature === "name",
  );
  assert.equal(f.state.applied, 0);
  assert.equal(f.state.aborted, 0);
});
test("targets include unsaved scope and discard a reply after source changes", async () => {
  let resolve!: (value: any) => void,
    request: any,
    revision = 1;
  const host: HostClient = {
    request<T>(_method: string, params: unknown) {
      request = params;
      return new Promise<T>((r) => (resolve = r));
    },
  };
  const session = new ViewSession(
    host,
    { revision: () => revision } as any,
    { setStale() {} } as any,
  );
  session.setAnalysis({ revision: 1, clean: true });
  session.selectedView = "view";
  session.setScope({
    schemaVersion: 1,
    ops: [{ op: "addSeed", element: "a" }],
  });
  const pending = session.targets("link", "source");
  assert.equal(request.scope.ops[0].element, "a");
  revision = 2;
  session.invalidate();
  resolve({
    revision: 1,
    viewKey: "view",
    toolId: "link",
    source: "source",
    symbols: ["old"],
  });
  assert.deepEqual(await pending, []);
});

for (const mode of ["stale", "hash", "fail", "typing"])
  test(`grid transaction retains ${mode} guard`, async () => {
    const f = await fixture(mode, true);
    await assert.rejects(
      f.session.command("trace-add", "row", { row: "r", column: "c" }),
    );
    assert.equal(f.state.published, 0);
    assert.equal(f.state.undo, mode === "fail" ? 1 : 0);
    assert.equal(f.state.text, mode === "typing" ? "beta typed" : "alpha");
  });
for (const changed of ["scope", "view", "typing", "request"])
  test(`grid targets discard late ${changed} reply`, async () => {
    let resolve!: (v: any) => void;
    let params: any;
    const host = {
      request<T>(method: string, p: unknown) {
        assert.equal(method, "views/gridTargets");
        params = p;
        return new Promise<T>((r) => {
          resolve = r;
        });
      },
    };
    const session = new ViewSession(
      host,
      { revision: () => 1 } as any,
      { setStale() {} } as any,
    );
    session.setAnalysis({ revision: 1, clean: true });
    session.selectedView = "matrix";
    session.setScope({
      schemaVersion: 1,
      ops: [{ op: "addSeed", element: "x" }],
    });
    const request = session.gridTargets("trace-add", "r", "c");
    assert.equal(params.scope.ops[0].element, "x");
    if (changed === "scope")
      session.exploration().append({ op: "hide", element: "x" });
    if (changed === "view") session.selectedView = "other";
    if (changed === "typing") session.invalidate();
    if (changed === "request") {
      const oldResolve = resolve;
      void session.gridTargets("trace-add", "other", "c");
      resolve = oldResolve;
    }
    resolve({
      revision: 1,
      viewKey: "matrix",
      toolId: "trace-add",
      row: "r",
      column: "c",
      member: null,
      enabled: true,
      reason: "",
    });
    assert.equal(await request, null);
  });

for (const changed of ["scope", "view", "typing", "request"])
  test(`label targets discard late ${changed} reply`, async () => {
    let resolve!: (v: any) => void;
    let params: any;
    const host = {
      request<T>(method: string, p: unknown) {
        assert.equal(method, "views/labelTargets");
        params = p;
        return new Promise<T>((r) => {
          resolve = r;
        });
      },
    };
    const session = new ViewSession(
      host,
      { revision: () => 1 } as any,
      { setStale() {} } as any,
    );
    session.setAnalysis({ revision: 1, clean: true });
    session.selectedView = "matrix";
    session.setScope({
      schemaVersion: 1,
      ops: [{ op: "addSeed", element: "x" }],
    });
    const request = session.labelTargets("field-value", "part");
    assert.equal(params.scope.ops[0].element, "x");
    if (changed === "scope")
      session.exploration().append({ op: "hide", element: "x" });
    if (changed === "view") session.selectedView = "other";
    if (changed === "typing") session.invalidate();
    if (changed === "request") {
      const oldResolve = resolve;
      void session.labelTargets("field-value", "other");
      resolve = oldResolve;
    }
    resolve({
      revision: 1,
      viewKey: "matrix",
      toolId: "field-value",
      part: "part",
      enabled: true,
      reason: "",
    });
    assert.equal(await request, null);
  });

test("rollback failure still aborts the candidate and revokes the session", async () => {
  const f = await fixture("rollback");
  await assert.rejects(
    f.session.command("create", "owner", {}),
    (error: unknown) =>
      error instanceof AggregateError && error.errors.length === 2,
  );
  assert.equal(f.state.aborted, 1);
  assert.equal(f.state.published, 0);
  assert.equal(f.state.text, "beta");
  await f.session.refresh();
  assert.equal(f.state.sceneCount, 0);
  await assert.rejects(f.session.command("create", "owner", {}));
});

for (const changed of [
  "scope",
  "view",
  "typing",
  "step",
  "lane",
  "before",
  "end",
  "palette",
]) {
  test(`lane targets discard late ${changed} reply`, async () => {
    let resolve!: (v: any) => void;
    const host = {
      request<T>(method: string) {
        assert.equal(method, "views/laneTargets");
        return new Promise<T>((r) => {
          resolve = r;
        });
      },
    };
    const session = new ViewSession(
      host,
      { revision: () => 1 } as any,
      { setStale() {} } as any,
    );
    session.setAnalysis({ revision: 1, clean: true });
    session.selectedView = "lanes";
    const pending = session.laneTargets("place-step", "s", "l", null, null),
      oldResolve = resolve;
    if (changed === "scope")
      session.exploration().append({ op: "hide", element: "x" });
    if (changed === "view") session.selectedView = "other";
    if (changed === "typing") session.invalidate();
    if (changed === "palette")
      session.palette = {
        schemaVersion: 1,
        id: "different",
        label: "Different",
        groups: [],
      };
    if (["step", "lane", "before", "end"].includes(changed))
      void session.laneTargets(
        "place-step",
        changed === "step" ? "other" : "s",
        changed === "lane" ? "other" : "l",
        changed === "before" ? "other" : null,
        changed === "end" ? "other" : null,
      );
    oldResolve({
      revision: 1,
      viewKey: "lanes",
      toolId: "place-step",
      step: "s",
      lane: "l",
      before: null,
      end: null,
      enabled: true,
      reason: "",
    });
    assert.equal(await pending, null);
  });
}
for (const field of [
  "revision",
  "viewKey",
  "toolId",
  "step",
  "lane",
  "before",
  "end",
]) {
  test(`lane target verifies ${field} echo`, async () => {
    const reply: any = {
      revision: 1,
      viewKey: "lanes",
      toolId: "place-step",
      step: "s",
      lane: "l",
      before: null,
      end: null,
      enabled: true,
      reason: "",
    };
    reply[field] = field === "revision" ? 2 : "wrong";
    const session = new ViewSession(
      {
        async request<T>() {
          return reply as T;
        },
      },
      { revision: () => 1 } as any,
      { setStale() {} } as any,
    );
    session.setAnalysis({ revision: 1, clean: true });
    session.selectedView = "lanes";
    await assert.rejects(
      session.laneTargets("place-step", "s", "l", null, null),
      /echo/,
    );
  });
}

for (const kind of ["graph", "grid", "label", "lane"])
  for (const change of ["scope", "palette", "palette-in-place"])
    for (const outcome of ["reply", "error"])
      test(`${kind} hints discard late ${change} ${outcome}`, async () => {
        let resolve!: (v: any) => void, reject!: (e: Error) => void;
        let params: any;
        const host: HostClient = {
          request<T>(_method: string, p: unknown) {
            params = p;
            return new Promise<T>((r, j) => {
              resolve = r;
              reject = j;
            });
          },
        };
        const session = new ViewSession(
          host,
          { revision: () => 1 } as any,
          { setStale() {} } as any,
        );
        session.setAnalysis({ revision: 1, clean: true });
        session.selectedView = "view";
        session.palette = { schemaVersion: 1, id: "p", label: "P", groups: [] };
        const pending =
          kind === "graph"
            ? session.targets("tool", "source")
            : kind === "grid"
              ? session.gridTargets("tool", "row", "column")
              : kind === "label"
                ? session.labelTargets("tool", "part")
                : session.laneTargets("tool", "step", "lane", null, null);
        if (change === "scope")
          session.exploration().append({ op: "hide", element: "old" });
        else if (change === "palette")
          session.palette = { ...session.palette, id: "other" };
        else session.palette.label = "Changed";
        const { scope: _scope, palette: _palette, ...echo } = params;
        if (outcome === "error")
          reject(new Error("Late obsolete hint failure"));
        else
          resolve({
            ...echo,
            ...(kind === "graph"
              ? { symbols: ["stale"] }
              : kind === "grid"
                ? { member: null, enabled: true, reason: "" }
                : { enabled: true, reason: "" }),
          });
        assert.deepEqual(await pending, kind === "graph" ? [] : null);
      });

for (const phase of ["catalog", "scene"])
  for (const change of ["view", "scope", "palette"])
    test(`refresh ignores late ${phase} reply after ${change} changes`, async () => {
      let resolve!: (v: any) => void;
      let scenes = 0,
        statuses = 0;
      const host: HostClient = {
        request<T>(method: string) {
          if (method === "views/scene" && phase === "catalog")
            return Promise.resolve(structuredClone(response) as T);
          if (method === "views/catalog" && phase === "scene")
            return Promise.resolve({
              revision: 1,
              views: [response.scene.view],
            } as T);
          return new Promise<T>((r) => {
            resolve = r;
          });
        },
      };
      const surface = {
        setStale() {},
        views() {},
        requestView() {},
        setScene() {
          scenes++;
        },
        status() {
          statuses++;
        },
      };
      const session = new ViewSession(
        host,
        { revision: () => 1 } as any,
        surface as any,
      );
      session.setAnalysis({ revision: 1, clean: true });
      session.selectedView = response.scene.view.key;
      const pending = session.refresh();
      await Promise.resolve();
      if (change === "view") session.selectedView = "other";
      if (change === "scope")
        session.exploration().append({ op: "hide", element: "old" });
      if (change === "palette")
        session.palette = {
          schemaVersion: 1,
          id: "other",
          label: "Other",
          groups: [],
        };
      resolve(
        phase === "catalog"
          ? { revision: 1, views: [response.scene.view] }
          : structuredClone(response),
      );
      await pending;
      assert.equal(scenes, 0);
      assert.equal(
        statuses,
        0,
        "a late reply cannot stale or report over the new context",
      );
    });

test("a refresh revokes the previous surface before waiting for the catalog", async () => {
  let stale = 0,
    resolve!: (v: any) => void;
  const session = new ViewSession(
    {
      request<T>() {
        return new Promise<T>((r) => {
          resolve = r;
        });
      },
    },
    { revision: () => 1 } as any,
    {
      setStale() {
        stale++;
      },
      views() {},
    } as any,
  );
  session.setAnalysis({ revision: 1, clean: true });
  const pending = session.refresh();
  assert.equal(stale, 1);
  resolve({ revision: 1, views: [] });
  await pending;
});

for (const change of ["view", "scope", "palette"])
  test(`prepared edit is aborted before apply after ${change} changes`, async () => {
    let resolve!: (v: any) => void;
    let applied = 0,
      aborted = 0,
      revision = 1,
      text = "a";
    const prepared = {
      schemaVersion: 1,
      token: "edit:1:1",
      baseRevision: 1,
      nextRevision: 2,
      created: "",
      patches: [
        {
          uri: "a",
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 },
          },
          original: "a",
          replacement: "b",
          beforeHash: await bufferHash("a"),
          afterHash: await bufferHash("b"),
        },
      ],
    };
    const session = new ViewSession(
      {
        request<T>(method: string) {
          if (method === "views/abortCommand") {
            aborted++;
            return Promise.resolve(null as T);
          }
          if (method === "views/commitCommand")
            return Promise.resolve({ revision: 2, clean: true } as T);
          if (method === "views/catalog")
            return Promise.resolve({ revision: 2, views: [] } as T);
          return new Promise<T>((r) => {
            resolve = r;
          });
        },
      },
      {
        revision: () => revision,
        reserveRevision() {},
        read: () => text,
        apply() {
          applied++;
          text = "b";
        },
        undo() {
          text = "a";
        },
        publish(a: any) {
          revision = a.revision;
        },
      } as any,
      { setStale() {}, views() {} } as any,
    );
    session.setAnalysis({ revision: 1, clean: true });
    session.selectedView = "view";
    const pending = session.command("tool", "owner", {});
    if (change === "view") session.selectedView = "other";
    if (change === "scope")
      session.exploration().append({ op: "hide", element: "old" });
    if (change === "palette")
      session.palette = {
        schemaVersion: 1,
        id: "other",
        label: "Other",
        groups: [],
      };
    resolve(prepared);
    await assert.rejects(pending, /changed/i);
    assert.equal(applied, 0);
    assert.equal(aborted, 1);
  });

for (const change of ["view", "scope", "palette"])
  for (const outcome of ["reply", "error"])
    test(`cursor ignores late ${change} ${outcome}`, async () => {
      let resolve!: (v: any) => void,
        reject!: (e: Error) => void,
        highlights = 0;
      const session = new ViewSession(
        {
          request<T>() {
            return new Promise<T>((r, j) => {
              resolve = r;
              reject = j;
            });
          },
        },
        { revision: () => 1 } as any,
        {
          setStale() {},
          highlight() {
            highlights++;
          },
        } as any,
      );
      session.setAnalysis({ revision: 1, clean: true });
      session.selectedView = "view";
      const pending = session.cursor("a", 0, 0);
      if (change === "view") session.selectedView = "other";
      if (change === "scope")
        session.exploration().append({ op: "hide", element: "old" });
      if (change === "palette")
        session.palette = {
          schemaVersion: 1,
          id: "new",
          label: "New",
          groups: [],
        };
      if (outcome === "error") reject(Error("Late obsolete cursor failure"));
      else resolve({ elementId: "old" });
      await pending;
      assert.equal(highlights, 0);
    });

for (const change of ["view","source","refresh"]) test(`M13 discards a late rendering resolution after ${change}`,async()=>{
 let resolve!:(value:unknown)=>void, revision=1, calls=0, accepted=0, scenes=0;
 const surface={views(){},requestView(){},setStale(){},status(){},highlight(){},setScene(){scenes++},rendering(){accepted++}};
 const host:HostClient={async request<T>(method:string):Promise<T>{if(method==="views/catalog")return {revision,views:[response.scene.view]} as T;if(method==="views/rendering"){calls++;return new Promise<T>(r=>resolve=r);}throw Error("Unexpected scene request");}};
 const session=new ViewSession(host,{revision:()=>revision} as any,surface);session.setAnalysis({revision:1,clean:true});session.selectedView=response.scene.view.key;
 const pending=session.refresh();await new Promise(r=>setImmediate(r));assert.equal(calls,1);
 if(change==="view")session.selectedView="other";else if(change==="source")revision=2;else session.invalidate();
 resolve({schemaVersion:1,revision:1,viewKey:response.scene.view.key,status:"unmanaged",selection:null,diagnostics:[]});await pending;
 assert.equal(accepted,0);assert.equal(scenes,0);
});
test("M13 unsupported rendering is observable and never requests a substitute scene",async()=>{
 let scenes=0,observed=0,status="";
 const host:HostClient={async request<T>(method:string):Promise<T>{
  if(method==="views/catalog")return {revision:1,views:[response.scene.view]} as T;
  if(method==="views/rendering")return {schemaVersion:1,revision:1,viewKey:response.scene.view.key,status:"unsupported",selection:null,diagnostics:[{code:"unknown.rendering",message:"Unknown explicit rendering",binding:response.scene.view.binding}]} as T;
  scenes++;throw Error("Substitute scene requested");
 }};
 const session=new ViewSession(host,{revision:()=>1} as any,{views(){},requestView(){},setStale(){},setScene(){},status(s:string){status=s},highlight(){},rendering(){observed++}});
 session.setAnalysis({revision:1,clean:true});session.selectedView=response.scene.view.key;await session.refresh();assert.equal(scenes,0);assert.equal(observed,1);assert.match(status,/Unknown explicit rendering/);
});
