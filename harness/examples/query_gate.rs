//! Executable WASM gate, separate from the production host protocol.
use intersect_model::core::{
    query::QueryBudget,
    storage::{ModelStore, atomic},
};
use intersect_view_host::grid_query::GridQuery;
use serde_json::json;
#[unsafe(no_mangle)]
pub extern "C" fn query_gate() -> u32 {
    let result = intersect_view_harness::with_definition(|d| {
        let model = intersect_view_harness::load(
            d,
            &[intersect_view_harness::Source {
                uri: "wasm-gate.harness".into(),
                text: format!(
                    "space S {{ kind K {{}} box A : K {{}} box B : K {{}} {} }}",
                    (0..260)
                        .map(|i| format!("box Extra{i} : K {{}} "))
                        .collect::<String>()
                ),
            }],
        )?
        .model;
        let mut ids = vec![];
        for name in ["B", "A"] {
            ids.push(
                model
                    .objects()
                    .find(|o| o.feature("name").and_then(|f| o.str(f)) == Some(name))
                    .ok_or("Missing gate element")?
                    .identity()
                    .to_owned(),
            );
        }
        let extras = (0..260)
            .rev()
            .map(|i| {
                model
                    .objects()
                    .find(|o| {
                        o.feature("name").and_then(|f| o.str(f))
                            == Some(format!("Extra{i}").as_str())
                    })
                    .map(|o| o.identity().to_owned())
                    .ok_or("Missing extra")
            })
            .collect::<Result<Vec<_>, _>>()?;
        let mut store = intersect_view_host::function_store(model)?;
        let mut budget = QueryBudget::new(10000);
        let q = GridQuery::prepare(
            d.schema(),
            &json!({"from":"Box","select":[{"name":"name","expression":{"op":"field","path":"name"}},{"name":"kind","expression":{"op":"field","path":"kind.name"}}]}),
        )?;
        let out = q.execute(d.schema(), &store, &ids, 500, &mut budget)?;
        if out.rows.len() != 2
            || out.rows[0][0] != "B"
            || out.rows[0][1] != "K"
            || out.rows[0][2] != ids[0]
            || budget.remaining() == 10000
        {
            return Err("WASM query result mismatch".into());
        }
        if q.execute(d.schema(), &store, &ids, 1, &mut budget).is_ok() {
            return Err("WASM query overflow accepted".into());
        }
        if q.execute(d.schema(), &store, &ids, 500, &mut QueryBudget::new(2))
            .is_ok()
        {
            return Err("WASM query budget ignored".into());
        }
        let out = q.execute(
            d.schema(),
            &store,
            &extras,
            500,
            &mut QueryBudget::new(100000),
        )?;
        if out.rows.len() != 260 || out.rows[129][2] != extras[129] {
            return Err("WASM paging order mismatch".into());
        }
        let indexed=GridQuery::prepare(d.schema(),&json!({"from":"Box","select":[{"name":"name","expression":{"op":"field","path":"name"}}],"filter":{"op":"compare","left":{"op":"field","path":"name"},"comparison":"eq","right":{"op":"literal","value":"A"}}}))?.execute(d.schema(),&store,&ids,500,&mut budget)?;
        if indexed.rows.len() != 1
            || indexed.rows[0][1] != ids[1]
            || !indexed.stats.access.contains("lookup")
        {
            return Err("WASM scoped native lookup mismatch".into());
        }
        atomic(&mut store, |s| s.set_revision("stale"))?;
        if q.execute(d.schema(), &store, &ids, 500, &mut budget)
            .is_ok()
        {
            return Err("WASM stale revision accepted".into());
        }
        Ok(())
    });
    u32::from(result.is_ok())
}
