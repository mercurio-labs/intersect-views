use intersect_model::core::{
    query::QueryBudget,
    storage::{ModelRead, ModelStore, atomic},
};
use intersect_view_host::grid_query::GridQuery;
use serde_json::json;
type Result = std::result::Result<(), Box<dyn std::error::Error>>;
#[test]
fn frozen_query_gate_ids_scope_reference_order_overflow_and_budget() -> Result {
    intersect_view_harness::with_definition(|d| {
        let model = intersect_view_harness::load(
            d,
            &[intersect_view_harness::Source {
                uri: "gate.harness".into(),
                text: format!(
                    "space S {{ kind K {{}} box A : K {{}} box B : K {{}} box Outside {{}} {} }}",
                    (0..260)
                        .map(|i| format!("box Extra{i} : K {{}} "))
                        .collect::<String>()
                ),
            }],
        )?
        .model;
        let find = |name: &str| {
            model
                .objects()
                .find(|o| o.feature("name").and_then(|f| o.str(f)) == Some(name))
                .map(|o| o.identity().to_owned())
                .ok_or_else(|| format!("No {name}"))
        };
        let candidates = vec![find("B")?, find("A")?];

        // Cross native 128-ID pages in reverse scope order; stable ties preserve it.
        let extras = (0..260)
            .rev()
            .map(|i| find(&format!("Extra{i}")))
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let mut store = intersect_view_host::function_store(model)?;
        let schema = d.schema();
        let template = json!({"from":"Box","select":[{"name":"name","expression":{"op":"field","path":"name"}},{"name":"kind","expression":{"op":"field","path":"kind.name"}}]});
        let query = GridQuery::prepare(schema, &template)?;
        let mut budget = QueryBudget::new(10000);
        let output = query.execute(schema, &store, &candidates, 500, &mut budget)?;
        assert_eq!(
            output.rows[0],
            json!(["B", "K", candidates[0]])
                .as_array()
                .ok_or("No row")?
                .clone()
        );
        assert_eq!(output.rows.len(), 2);
        assert!(budget.remaining() < 10000);
        let output = query.execute(schema, &store, &extras, 500, &mut QueryBudget::new(100000))?;
        assert_eq!(output.rows.len(), 260);
        assert_eq!(output.rows[129][2], extras[129]);
        let mut tied = template.clone();
        tied["order_by"] = json!([{"expression":{"op":"field","path":"kind.name"}}]);
        let out = GridQuery::prepare(schema, &tied)?.execute(
            schema,
            &store,
            &candidates,
            500,
            &mut budget,
        )?;
        assert_eq!(out.rows[0][0], "B");
        tied["order_by"] = json!([{"expression":{"op":"field","path":"name"}}]);
        let out = GridQuery::prepare(schema, &tied)?.execute(
            schema,
            &store,
            &candidates,
            500,
            &mut budget,
        )?;
        assert_eq!(out.rows[0][0], "A");
        let mut indexed = template.clone();
        indexed["filter"] = json!({"op":"compare","left":{"op":"field","path":"name"},"comparison":"eq","right":{"op":"literal","value":"A"}});
        let output = GridQuery::prepare(schema, &indexed)?.execute(
            schema,
            &store,
            &candidates,
            500,
            &mut budget,
        )?;
        assert_eq!(output.rows[0][0], "A");
        assert!(output.stats.access.contains("lookup"));
        assert!(
            query
                .execute(schema, &store, &candidates, 1, &mut budget)
                .err()
                .ok_or("No overflow")?
                .contains("has_more")
        );
        assert!(
            query
                .execute(schema, &store, &candidates, 500, &mut QueryBudget::new(2))
                .is_err()
        );
        atomic(&mut store, |s| s.set_revision("stale"))?;
        assert_ne!(store.revision()?, schema.revision);
        assert!(
            query
                .execute(schema, &store, &candidates, 500, &mut budget)
                .is_err()
        );
        Ok(())
    })?;
    Ok(())
}
