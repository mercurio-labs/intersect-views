use intersect_model::{
    core::{
        frozen::{FrozenStore, Model, Obj},
        query::QueryBudget,
        storage::{self, ModelRead},
    },
    definitions::rcore_behavior::ir_v2::{DataWire, Effect, Limits, ValueWire},
    rcore::ExecutionLimits,
    source_model_functions::SourceModelFunction,
};
use intersect_text::preparation::PreparedLanguageDefinition;
use intersect_view_harness::{
    SOURCE_LIMITS, Source, VIEW_FUNCTIONS, function_store, load, selection, view_source,
    with_definition,
};
use std::{
    hint::black_box,
    time::{Duration, Instant},
};

fn named<'a>(model: &'a Model, name: &str) -> Result<Obj<'a>, String> {
    model
        .objects()
        .find(|obj| obj.feature("name").and_then(|feature| obj.str(feature)) == Some(name))
        .ok_or_else(|| format!("Missing object {name}"))
}

fn compile<'a>(
    definition: &'a PreparedLanguageDefinition<'_>,
    text: &str,
    name: &str,
) -> Result<SourceModelFunction<'a>, String> {
    let source = view_source(definition, text);
    SourceModelFunction::from_prepared(
        definition,
        vec![source.clone()],
        &selection(definition, &source, name)?,
        &Limits::default(),
        ExecutionLimits::default(),
        SOURCE_LIMITS,
    )
}

fn scalar(value: &ValueWire) -> Result<&serde_json::Value, String> {
    match &value.data {
        DataWire::Scalar(value) => Ok(&value.payload),
        other => Err(format!("Expected scalar, got {other:?}")),
    }
}

fn elements<'a>(model: &'a Model, value: &ValueWire) -> Result<Vec<Obj<'a>>, String> {
    let DataWire::Collection(values) = &value.data else {
        return Err(format!("Expected collection, got {:?}", value.data));
    };
    values
        .iter()
        .map(|value| {
            let DataWire::Model(json) = &value.data else {
                return Err(format!("Expected model result, got {:?}", value.data));
            };
            let identity = json
                .get("element")
                .and_then(|value| value.as_str())
                .ok_or("Missing result identity")?;
            model
                .lookup(identity)
                .ok_or_else(|| format!("Result absent from frozen model: {identity}"))
        })
        .collect()
}

#[test]
fn text_to_frozen_model_and_three_view_results() -> Result<(), String> {
    with_definition(|definition| {
        let loaded = load(
            definition,
            &[Source {
                uri: "basic.harness".into(),
                text: include_str!("../models/basic.harness").into(),
            }],
        )?;
        assert_eq!(loaded.model.len(), 5);
        assert!(loaded.issues.is_empty(), "{:?}", loaded.issues);
        assert_eq!(loaded.unresolved_occurrences, 1);
        assert_eq!(loaded.proxies, 1);
        let model = &loaded.model;
        let alpha = named(model, "Alpha")?;
        let empty = named(model, "Empty")?;
        let peer = alpha.feature("peer").ok_or("Missing peer feature")?;
        assert_eq!(
            alpha.refs(peer).map(|obj| obj.id()).collect::<Vec<_>>(),
            vec![empty.id()]
        );
        let select = compile(definition, VIEW_FUNCTIONS, "boxFields")?;
        let condition = compile(definition, VIEW_FUNCTIONS, "boxHasFields")?;
        let label = compile(definition, VIEW_FUNCTIONS, "boxTitle")?;
        // Preserve the original failure as a control, then prove public revision
        // initialization is sufficient with the exact same frozen model.
        let uninitialized = FrozenStore::from_model(model.clone());
        assert_eq!(uninitialized.revision()?, "");
        assert_eq!(
            select
                .invoke_model(
                    &uninitialized,
                    alpha.identity(),
                    vec![],
                    &mut QueryBudget::new(100_000)
                )
                .err()
                .ok_or("Expected uninitialized revision refusal")?,
            "Rcore scope model has a different schema revision"
        );
        let store = function_store(model.clone())?;
        assert_eq!(store.revision()?, definition.schema().revision);
        let mut budget = QueryBudget::new(2_000_000);
        let value = select.invoke_model(&store, alpha.identity(), vec![], &mut budget)?;
        assert_eq!(
            elements(model, &value)?
                .iter()
                .map(|obj| obj.id())
                .collect::<Vec<_>>(),
            vec![named(model, "first")?.id(), named(model, "second")?.id()]
        );
        assert!(
            elements(
                model,
                &select.invoke_model(&store, empty.identity(), vec![], &mut budget)?
            )?
            .is_empty()
        );
        assert_eq!(
            scalar(&condition.invoke_model(&store, alpha.identity(), vec![], &mut budget)?)?,
            &serde_json::json!(true)
        );
        assert_eq!(
            scalar(&condition.invoke_model(&store, empty.identity(), vec![], &mut budget)?)?,
            &serde_json::json!(false)
        );
        assert_eq!(
            scalar(&label.invoke_model(&store, alpha.identity(), vec![], &mut budget)?)?,
            &serde_json::json!("Alpha")
        );
        assert_eq!(
            scalar(&label.invoke_model(&store, empty.identity(), vec![], &mut budget)?)?,
            &serde_json::json!("Empty")
        );
        assert!(budget.reads > 0);
        assert_eq!(model.len(), 5);
        Ok(())
    })
}

#[test]
fn function_names_resolve_through_public_module_symbols() -> Result<(), String> {
    with_definition(|definition| {
        let original = view_source(definition, VIEW_FUNCTIONS);
        let selected = selection(definition, &original, "boxTitle")?;
        assert_eq!(selected.symbol.source, original.id);
        // A preceding declaration shifts the ordinal. Name lookup follows it.
        let shifted_text = VIEW_FUNCTIONS.replace(
            "pub fn boxFields",
            "fn helper(self:h.Box)->Bool = true;\npub fn boxFields",
        );
        let shifted = view_source(definition, &shifted_text);
        assert_eq!(
            selection(definition, &shifted, "boxTitle")?
                .symbol
                .declaration,
            selected.symbol.declaration + 1
        );
        assert!(selection(definition, &shifted, "helper").is_err());
        assert!(selection(definition, &original, "missing").is_err());
        let function = compile(definition, &shifted_text, "boxTitle")?;
        let loaded = load(
            definition,
            &[Source {
                uri: "shift.harness".into(),
                text: "space S { box Shifted {} }".into(),
            }],
        )?;
        let owner = named(&loaded.model, "Shifted")?.identity().to_owned();
        let store = function_store(loaded.model)?;
        assert_eq!(
            scalar(&function.invoke_model(
                &store,
                &owner,
                vec![],
                &mut QueryBudget::new(100_000)
            )?)?,
            &serde_json::json!("Shifted")
        );
        eprintln!(
            "M0 name mapping: boxTitle declaration {} -> {} after inserting helper",
            selected.symbol.declaration,
            selected.symbol.declaration + 1
        );
        Ok(())
    })
}

#[test]
fn construction_is_refused_at_runtime() -> Result<(), String> {
    with_definition(|definition| {
        let text = "rcore 1; package constructing version \"1\"; import model \"urn:intersect:harness:1\" as h; pub fn make(self:h.Box)->h.Field = new h.Field { name: self.name, value: 1 }; pub fn indirect(self:h.Box)->h.Field = make(self);";
        let loaded = load(
            definition,
            &[Source {
                uri: "construction.harness".into(),
                text: "space S { box Owner {} }".into(),
            }],
        )?;
        let owner = named(&loaded.model, "Owner")?.identity().to_owned();
        let store = function_store(loaded.model)?;
        let before = storage::export(&store)?;
        for name in ["make", "indirect"] {
            // Compilation succeeds. Runtime must refuse direct and transitive
            // construction on a correctly initialized store, for its effect.
            let function = compile(definition, text, name)?;
            let image = function.executable();
            assert_eq!(
                image
                    .function_effect(image.program().entry)
                    .map_err(|error| error.to_string())?,
                Effect::Construct
            );
            let error = function
                .invoke_model(&store, &owner, vec![], &mut QueryBudget::new(100_000))
                .err()
                .ok_or_else(|| format!("Construction {name} was accepted at runtime"))?;
            eprintln!("M0 runtime construction refusal ({name}): {error}");
            assert_eq!(
                error,
                "`new` runs only for implicit elements on the direct executor"
            );
        }
        assert_eq!(storage::export(&store)?, before);
        Ok(())
    })
}

#[test]
fn timings_500_objects_and_5000_invocations() -> Result<(), String> {
    with_definition(|definition| {
        // Exactly 500 objects: one Space, 249 Boxes, 250 Fields.
        let mut text = String::from("space Benchmark {");
        for index in 0..249 {
            text.push_str(&format!("box B{index} {{ field F{index} = 1;"));
            if index == 0 {
                text.push_str("field Extra = 2;");
            }
            text.push('}');
        }
        text.push('}');
        let loaded = load(
            definition,
            &[Source {
                uri: "benchmark.harness".into(),
                text,
            }],
        )?;
        assert!(loaded.issues.is_empty());
        assert_eq!(loaded.model.len(), 500);
        let owner = named(&loaded.model, "B0")?.identity().to_owned();
        let functions = [
            compile(definition, VIEW_FUNCTIONS, "boxFields")?,
            compile(definition, VIEW_FUNCTIONS, "boxHasFields")?,
            compile(definition, VIEW_FUNCTIONS, "boxTitle")?,
        ];
        let start = Instant::now();
        let store = black_box(function_store(black_box(&loaded.model).clone())?);
        let clone_elapsed = start.elapsed();
        eprintln!(
            "M0 timings: objects=500 clone_into_initialized_store_us={}",
            clone_elapsed.as_micros()
        );
        // Measure completion of all calls; the future engine's aggregate work
        // allowance is a separate M3 limit, not a bound for this M0 timing.
        let mut budget = QueryBudget::new(100_000_000);
        let start = Instant::now();
        for index in 0..5000 {
            let result = functions[index % 3]
                .invoke_model(&store, &owner, vec![], &mut budget)
                .map_err(|error| format!("Call {} of 5,000: {error}", index + 1))?;
            black_box(result);
            if start.elapsed() > Duration::from_secs(2) {
                return Err(format!(
                    "STOP: only {} of 5,000 calls completed within two seconds",
                    index + 1
                ));
            }
        }
        let calls_elapsed = start.elapsed();
        eprintln!(
            "M0 timings: objects=500 clone_into_initialized_store_us={} calls=5000 mixed_sequence_bool_string_us={} budget_reads={}",
            clone_elapsed.as_micros(),
            calls_elapsed.as_micros(),
            budget.reads
        );
        assert!(
            calls_elapsed <= Duration::from_secs(2),
            "STOP: 5,000 invoke_model calls exceeded two seconds: {calls_elapsed:?}"
        );
        Ok(())
    })
}
