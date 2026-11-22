//! Prepared-language integration without a language-specific host dependency.
use intersect_model::{
    components::{ComponentImage, MountedDraft, SharedSchema},
    core::frozen::Metamodel,
    definitions::ecore_migration::BundleMigrationReport,
    storage::ModelRead,
};
use intersect_text::{
    Source,
    package::{BundleCompilation, CompilationSourcePolicy},
    preparation::PreparedLanguageDefinition,
};
use intersect_view_host::{
    Host, LoadedModel, LoadedSources, ModelView, ModelViewContext, ModelViews, NoCommands,
    PreparedLanguageProvider, ProjectMetadata, SourceLoader,
};
use serde_json::{Value, json};
use std::{cell::Cell, collections::BTreeMap, rc::Rc, sync::Arc};

type Result<T = ()> = std::result::Result<T, String>;
const LIBRARY_URI: &str = "library:/builtins.harness";
const LIBRARY: &str = "space Library { box ReadOnly {} }";

struct Provider {
    compilation: BundleCompilation,
    migration: BundleMigrationReport,
    calls: Rc<Cell<usize>>,
}
impl PreparedLanguageProvider for Provider {
    fn prepare(&self) -> Result<PreparedLanguageDefinition<'_>> {
        self.calls.set(self.calls.get() + 1);
        let policy = CompilationSourcePolicy::default();
        intersect_text::compiler::prepare_bundle_with_borrowed_authored_validation(
            &self.compilation,
            &self.migration,
            intersect_text::grammar::Profile::NativeV80,
            &[],
            None,
            policy,
            policy,
            &|_, _, _| Ok(()),
        )
        .map_err(|e| format!("Fixture preparation: {e:?}"))
    }
}
struct Loader {
    library: &'static str,
    language: Host,
    calls: Rc<Cell<usize>>,
    collide: Rc<Cell<bool>>,
    mounted: Option<(Arc<SharedSchema>, Arc<ComponentImage>)>,
}
impl SourceLoader for Loader {
    fn load(&self, sources: &[Source]) -> Result<LoadedSources> {
        self.calls.set(self.calls.get() + 1);
        let mut all = sources.to_vec();
        if self.mounted.is_none() {
            all.push(Source {
                uri: LIBRARY_URI.into(),
                text: self.library.into(),
            });
        }
        let load = self.language.with_definition(|definition| {
            let bindings = intersect_view_harness::definition().bindings;
            intersect_view_host::load_prepared(definition, &bindings, &all)
        })?;
        let mut load: intersect_view_host::ProjectLoad = load.into();
        let mut library_uri = LIBRARY_URI.to_owned();
        if let Some((schema, image)) = &self.mounted
            && let Some(LoadedModel::Frozen(project)) = load.model.take()
        {
            let mut draft = MountedDraft::new(schema.clone(), vec![image.clone()])?;
            *draft.project_store_mut() = intersect_view_host::function_store(*project)?;
            let mounted = draft.finish()?.into_read_model()?;
            library_uri = mounted
                .model()
                .resource_records()?
                .into_values()
                .find(|record| record.package.as_ref() == Some(image.identity()))
                .ok_or("Missing mounted resource")?
                .uri;
            load.model = Some(LoadedModel::Mounted(Rc::new(mounted)));
        }
        let mut reference_sources = BTreeMap::from([(library_uri.clone(), self.library.into())]);
        if self.collide.get() {
            reference_sources.insert("model.harness".into(), "read-only impostor".into());
        }
        Ok(LoadedSources {
            load,
            reference_sources,
            metadata: ProjectMetadata {
                project: Some(json!({"name":"example"})),
                dependency_uris: vec![library_uri],
                dependencies: vec![json!({"name":"builtins"})],
                notes: vec!["Language-owned dependency receipt".into()],
            },
        })
    }
}
struct Fixture {
    host: Host,
    provider_calls: Rc<Cell<usize>>,
    loader_calls: Rc<Cell<usize>>,
    collide: Rc<Cell<bool>>,
    sources: Vec<Source>,
}
fn call(host: &mut Host, method: &str, params: Value) -> Result<Value> {
    host.dispatch(json!({"method":method,"params":params}))
}
impl Fixture {
    fn new() -> Result<Self> {
        Self::with_library(LIBRARY)
    }
    fn with_library(library: &'static str) -> Result<Self> {
        Self::with_backing(library, false)
    }
    fn with_backing(library: &'static str, mount: bool) -> Result<Self> {
        let mut definition = intersect_view_harness::definition();
        definition
            .view_functions
            .last_mut()
            .ok_or("No view module")?
            .text
            .push_str(
                "\npub fn catalogChildren(self:h.Box)->Sequence<h.Box> = [self];\n\
             pub fn catalogTitle(self:h.Box)->String = self.name + \" catalog\";\n",
            );
        let module = definition
            .view_functions
            .last_mut()
            .ok_or("No view module")?;
        module.id = intersect_model::definitions::bundle::DefinitionSource::new(
            &module.id.uri,
            module.kind,
            &module.text,
        )
        .id;
        definition.extra_functions = vec!["catalogChildren".into(), "catalogTitle".into()];
        let language = Host::new(definition.clone(), Box::new(NoCommands))?;
        let provider_calls = Rc::new(Cell::new(0));
        let loader_calls = Rc::new(Cell::new(0));
        let collide = Rc::new(Cell::new(false));
        let (compilation, migration, metamodel) = language.with_definition(|view| {
            Ok((
                view.selection().to_owned(),
                view.migration().clone(),
                Arc::new(Metamodel::freeze(view.schema()).map_err(|e| e.to_string())?),
            ))
        })?;
        let mounted = if mount {
            let load = language.with_definition(|view| {
                intersect_view_host::load_prepared(
                    view,
                    &definition.bindings,
                    &[Source {
                        uri: LIBRARY_URI.into(),
                        text: library.into(),
                    }],
                )
            })?;
            let library = load.model.ok_or("Fixture library did not load")?;
            let schema = SharedSchema::from_metamodel(metamodel.clone())?;
            let image = ComponentImage::prepare(schema.clone(), "urn:harness:library", library)?;
            Some((schema, image))
        } else {
            None
        };
        let host = Host::from_prepared(
            definition,
            Box::new(Provider {
                compilation,
                migration,
                calls: provider_calls.clone(),
            }),
            metamodel,
            Box::new(Loader {
                library,
                language,
                calls: loader_calls.clone(),
                collide: collide.clone(),
                mounted,
            }),
            Box::new(intersect_view_harness::HarnessCommands),
        )?;
        let sources = vec![
            Source {
                uri: "model.harness".into(),
                text: "space Project { box Alpha {} }".into(),
            },
            Source {
                uri: "structure.view.json".into(),
                text: include_str!("../../../harness/models/structure.view.json").into(),
            },
        ];
        Ok(Self {
            host,
            provider_calls,
            loader_calls,
            collide,
            sources,
        })
    }
    fn analyze(&mut self, revision: u64, project_only: bool) -> Result<Value> {
        call(
            &mut self.host,
            "workspace/analyze",
            json!({"revision":revision,"sources":self.sources,"projectNodesOnly":project_only}),
        )
    }
    fn owner(&mut self, name: &str) -> Result<String> {
        let catalog = call(&mut self.host, "views/catalog", json!({"revision":1}))?;
        catalog["views"][0]["owners"]
            .as_array()
            .ok_or("No owners")?
            .iter()
            .find(|o| o["label"] == name)
            .and_then(|o| o["key"].as_str())
            .map(str::to_owned)
            .ok_or_else(|| format!("No owner {name}"))
    }
    fn prepare(&mut self, owner: &str) -> Result<Value> {
        call(
            &mut self.host,
            "views/prepareCommand",
            json!({
                "revision":1,"viewKey":"structure-1","toolId":"box","ownerKey":owner,
                "scope":{"schemaVersion":1,"ops":[{"op":"addSeed","element":owner}]},
                "arguments":{"name":"Created"}
            }),
        )
    }
}

#[test]
fn prepared_owner_is_retained_once_and_read_only_sources_remain_separate() -> Result {
    let mut f = Fixture::new()?;
    assert_eq!(f.provider_calls.get(), 1);
    let analysis = f.analyze(1, false)?;
    assert_eq!(analysis["clean"], true, "{analysis}");
    assert_eq!(analysis["nodes"].as_array().ok_or("No nodes")?.len(), 4);
    assert_eq!(analysis["project"]["name"], "example");
    assert_eq!(analysis["dependencyUris"], json!([LIBRARY_URI]));
    assert_eq!(analysis["dependencies"][0]["name"], "builtins");
    assert_eq!(analysis["notes"][0], "Language-owned dependency receipt");
    let owner = f.owner("ReadOnly")?;
    let response = call(
        &mut f.host,
        "views/scene",
        json!({
            "revision":1,"viewKey":"structure-1",
            "scope":{"schemaVersion":1,"ops":[{"op":"addSeed","element":owner}]}
        }),
    )?;
    assert_eq!(response["scene"]["nodes"][0]["binding"]["readOnly"], true);
    assert_eq!(
        call(
            &mut f.host,
            "intersect/source",
            json!({"revision":1,"uri":LIBRARY_URI})
        )?["text"],
        LIBRARY
    );
    let refused = f.prepare(&owner)?;
    assert_eq!(refused["code"], "edit.inapplicable", "{refused}");
    let project_only = f.analyze(2, true)?;
    assert_eq!(project_only["nodes"].as_array().ok_or("No nodes")?.len(), 2);
    assert_eq!(f.provider_calls.get(), 1);
    assert_eq!(f.loader_calls.get(), 2);
    Ok(())
}

#[test]
fn prepared_loader_runs_candidates_and_receipts_contain_only_editor_buffers() -> Result {
    let mut f = Fixture::new()?;
    assert_eq!(f.analyze(1, true)?["clean"], true);
    let owner = f.owner("Alpha")?;
    let prepared = f.prepare(&owner)?;
    assert_eq!(
        f.loader_calls.get(),
        2,
        "candidate uses the same external loader"
    );
    let patch = &prepared["patches"][0];
    assert_eq!(patch["uri"], "model.harness");
    // This fixture has one ASCII line, so UTF-16 offsets are byte offsets.
    let start = patch["range"]["start"]["character"]
        .as_u64()
        .ok_or("No start")? as usize;
    let end = patch["range"]["end"]["character"]
        .as_u64()
        .ok_or("No end")? as usize;
    let replacement = patch["replacement"].as_str().ok_or("No replacement")?;
    f.sources[0].text.replace_range(start..end, replacement);
    let mut overbroad_receipt = f.sources.clone();
    overbroad_receipt.push(Source {
        uri: LIBRARY_URI.into(),
        text: LIBRARY.into(),
    });
    assert!(
        call(
            &mut f.host,
            "views/commitCommand",
            json!({
                "revision":1,"token":prepared["token"],"sources":overbroad_receipt
            })
        )
        .is_err()
    );
    let committed = call(
        &mut f.host,
        "views/commitCommand",
        json!({
            "revision":1,"token":prepared["token"],"sources":f.sources
        }),
    )?;
    assert_eq!(committed["revision"], 2);
    assert_eq!(committed["clean"], true);
    assert_eq!(
        committed["nodes"].as_array().ok_or("No nodes")?.len(),
        3,
        "candidate publication preserves the accepted project-only projection"
    );
    assert!(
        committed["nodes"]
            .as_array()
            .ok_or("No nodes")?
            .iter()
            .any(|n| n["name"] == "Created")
    );
    assert_eq!(
        f.provider_calls.get(),
        1,
        "cached functions retain their checked owner"
    );
    assert_eq!(
        f.loader_calls.get(),
        2,
        "commit publishes the isolated candidate without loading twice"
    );
    Ok(())
}

#[test]
fn prepared_project_requires_the_same_host_and_accepted_epoch() -> Result {
    let mut f = Fixture::with_backing(LIBRARY, true)?;
    f.analyze(1, false)?;
    let prepared = f.host.prepare_project(2, f.sources.clone(), false)?;
    assert_eq!(
        f.host.source(&f.sources[0].uri),
        Some(f.sources[0].text.as_str())
    );
    let mut other = Fixture::with_backing(LIBRARY, true)?;
    other.analyze(1, false)?;
    assert!(other.host.adopt_project(prepared).is_err());
    let stale = f.host.prepare_project(2, f.sources.clone(), false)?;
    f.analyze(1, false)?;
    assert!(f.host.adopt_project(stale).is_err());
    let current = f.host.prepare_project(2, f.sources.clone(), false)?;
    assert_eq!(f.host.adopt_project(current)?["revision"], 2);
    Ok(())
}

struct CheckMountedRoot;

impl ModelViews for CheckMountedRoot {
    fn views(&self, context: &ModelViewContext<'_>) -> Result<Vec<ModelView>> {
        let root = context
            .model()
            .objects()
            .find(|object| {
                object.feature("name").and_then(|name| object.str(name)) == Some("ReadOnly")
            })
            .ok_or("Missing mounted root")?;
        let element = context
            .element(&context.key(root)?)
            .ok_or("Mounted key did not resolve")?;
        assert_eq!(element.identity(), root.identity());
        assert!(!context.editable(element));
        Ok(vec![])
    }
}

#[test]
fn mounted_project_uses_one_scene_and_the_same_loader_for_source_edits() -> Result {
    let mut f = Fixture::with_backing(LIBRARY, true)?;
    f.host = f.host.with_model_views(Box::new(CheckMountedRoot));
    let analysis = f.analyze(1, false)?;
    assert_eq!(analysis["clean"], true, "{analysis}");
    let owner = f.owner("Alpha")?;
    let dependency = f.owner("ReadOnly")?;
    let response = call(
        &mut f.host,
        "views/scene",
        json!({"revision":1,"viewKey":"structure-1","scope":{"schemaVersion":1,"ops":[
            {"op":"addSeed","element":owner},{"op":"addSeed","element":dependency}
        ]}}),
    )?;
    let nodes = response["scene"]["nodes"]
        .as_array()
        .ok_or("No graph nodes")?;
    assert!(
        nodes
            .iter()
            .any(|n| n["binding"]["key"] == owner && n["binding"]["readOnly"] == false)
    );
    assert!(
        nodes
            .iter()
            .any(|n| n["binding"]["key"] == dependency && n["binding"]["readOnly"] == true)
    );
    let refused = f.prepare(&dependency)?;
    assert_eq!(refused["code"], "edit.inapplicable", "{refused}");
    let prepared = f.prepare(&owner)?;
    assert!(prepared.get("token").is_some(), "{prepared}");
    let patch = &prepared["patches"][0];
    assert_eq!(patch["uri"], f.sources[0].uri);
    let offset = |end: &str| -> Result<usize> {
        Ok(patch["range"][end]["character"]
            .as_u64()
            .ok_or("Missing patch offset")? as usize)
    };
    f.sources[0].text.replace_range(
        offset("start")?..offset("end")?,
        patch["replacement"]
            .as_str()
            .ok_or("Missing patch replacement")?,
    );
    let committed = call(
        &mut f.host,
        "views/commitCommand",
        json!({
            "revision":1,"token":prepared["token"],"sources":f.sources,
        }),
    )?;
    assert_eq!(committed["revision"], 2);
    assert!(
        committed["nodes"]
            .as_array()
            .ok_or("No model nodes")?
            .iter()
            .any(|n| n["name"] == "Created")
    );
    assert_eq!(analysis["dependencyUris"], committed["dependencyUris"]);
    let library_uri = committed["dependencyUris"][0]
        .as_str()
        .ok_or("Missing library URI")?;
    assert_eq!(f.host.source(library_uri), Some(LIBRARY));
    assert_eq!(f.loader_calls.get(), 2);
    Ok(())
}

#[test]
fn colliding_read_only_sources_fail_closed_and_clear_previous_bindings() -> Result {
    let mut f = Fixture::new()?;
    assert_eq!(f.analyze(1, true)?["clean"], true);
    f.collide.set(true);
    assert!(
        f.analyze(2, true)
            .err()
            .ok_or("Collision accepted")?
            .contains("collides")
    );
    assert!(call(&mut f.host, "views/catalog", json!({"revision":2})).is_err());
    assert!(
        call(
            &mut f.host,
            "intersect/source",
            json!({"revision":2,"uri":LIBRARY_URI})
        )
        .is_err()
    );
    f.collide.set(false);
    f.sources[0].text = "space Project { box".into();
    let invalid = f.analyze(3, true)?;
    assert_eq!(invalid["clean"], false);
    assert!(call(&mut f.host, "views/catalog", json!({"revision":3})).is_err());
    Ok(())
}

struct Catalog(Rc<Cell<u8>>);
impl ModelViews for Catalog {
    fn views(&self, context: &ModelViewContext<'_>) -> Result<Vec<ModelView>> {
        let owner = context
            .model()
            .objects()
            .find(|o| {
                context.editable(*o) && o.feature("name").and_then(|f| o.str(f)) == Some("Alpha")
            })
            .ok_or("Missing catalog fixture owner")?;
        let seeds = context.elements("catalogChildren", owner)?;
        assert_eq!(seeds.len(), 1);
        let key = if self.0.get() == 1 {
            "structure-1"
        } else {
            "model-view"
        };
        let mut binding = context.binding(owner)?;
        if self.0.get() == 2 {
            binding.read_only = true;
        }
        let problems = if self.0.get() == 3 {
            vec!["Unsupported view condition"]
        } else {
            vec![]
        };
        let owners = if self.0.get() >= 4 {
            let wanted = if self.0.get() == 4 {
                "Outer"
            } else {
                "Project"
            };
            let root = context
                .model()
                .objects()
                .find(|o| o.feature("name").and_then(|f| o.str(f)) == Some(wanted))
                .ok_or("No declared canvas owner")?;
            vec![json!({"key":context.key(root)?,"label":wanted})]
        } else {
            vec![]
        };
        let view = serde_json::from_value(json!({
            "key":key,"name":context.string("catalogTitle", owner)?,
            "kind":"model-defined","binding":binding,
            "owners":owners,"details":[],"problems":problems,
        }))
        .map_err(|e| e.to_string())?;
        let document = serde_json::from_value(json!({
            "schemaVersion":1,"key":key,"name":"Model view","ruleSet":"harness.structure",
            "scope":{"schemaVersion":1,"ops":[{"op":"addSeed","element":context.key(seeds[0])?}]}
        }))
        .map_err(|e| e.to_string())?;
        if self.0.get() == 6 {
            let view: intersect_views::View = view;
            let diagnostic = intersect_views::RenderingDiagnostic {
                code: "fixture.unsupported".into(),
                message: "Unknown model rendering".into(),
                binding: view.binding.clone(),
            };
            return Ok(vec![ModelView::Unsupported {
                view,
                diagnostics: vec![diagnostic],
            }]);
        }
        Ok(vec![ModelView::Resolved {
            document,
            view,
            selection: None,
        }])
    }
}

#[test]
fn model_defined_views_use_cached_extra_functions_and_real_bindings() -> Result {
    let mut f = Fixture::new()?;
    let mode = Rc::new(Cell::new(0));
    f.host = f.host.with_model_views(Box::new(Catalog(mode.clone())));
    assert_eq!(f.analyze(1, true)?["clean"], true);
    let catalog = f.host.view_catalog(1)?;
    assert_eq!(catalog.views.len(), 2);
    let view = &catalog.views[1];
    assert_eq!(view.key, "model-view");
    assert_eq!(view.name, "Alpha catalog");
    assert_eq!(view.binding.uri, "model.harness");
    assert!(!view.binding.read_only);
    let scene = f.host.view_scene(1, &view.key, None, None)?;
    scene.validate()?;
    assert_eq!(scene.scene.graph()?.nodes.len(), 1);
    assert_eq!(scene.scene.graph()?.nodes[0].binding.key, view.binding.key);
    assert!(f.host.view_scene(2, &view.key, None, None).is_err());
    mode.set(6);
    assert_eq!(f.host.view_catalog(1)?.views.len(), 2);
    let resolution = call(
        &mut f.host,
        "views/rendering",
        json!({"revision":1,"viewKey":"model-view"}),
    )?;
    assert_eq!(resolution["status"], "unsupported");
    assert_eq!(resolution["selection"], Value::Null);
    assert!(f.host.view_scene(1, "model-view", None, None).is_err());
    assert!(
        call(
            &mut f.host,
            "views/rendering",
            json!({"revision":0,"viewKey":"model-view"})
        )
        .is_err()
    );
    assert!(
        call(
            &mut f.host,
            "views/rendering",
            json!({"revision":1,"viewKey":"model-view","extra":true})
        )
        .is_err()
    );
    assert!(f.host.view_scene(1, "structure-1", None, None).is_ok());
    mode.set(1);
    assert!(
        f.host
            .view_catalog(1)
            .err()
            .ok_or("Duplicate catalog key accepted")?
            .contains("Duplicate")
    );
    mode.set(2);
    assert!(
        f.host
            .view_catalog(1)
            .err()
            .ok_or("Incorrect binding accepted")?
            .contains("binding")
    );
    mode.set(3);
    assert_eq!(
        f.host.view_catalog(1)?.views[1].problems,
        ["Unsupported view condition"]
    );
    assert!(
        f.host
            .view_scene(1, "model-view", None, None)
            .err()
            .ok_or("Unsupported view rendered")?
            .contains("Unsupported view condition")
    );
    assert_eq!(f.provider_calls.get(), 1);
    assert_eq!(f.loader_calls.get(), 1);
    Ok(())
}

#[test]
fn only_model_defined_views_can_declare_predicated_canvas_owners() -> Result {
    let mut f = Fixture::new()?;
    f.sources[0].text = "space Project { box Outer { box Alpha {} } }".into();
    let mode = Rc::new(Cell::new(4));
    f.host = f.host.with_model_views(Box::new(Catalog(mode.clone())));
    assert_eq!(f.analyze(1, true)?["clean"], true);
    let catalog = f.host.view_catalog(1)?;
    let native = &catalog.views[1];
    let outer = native.owners[0].key.clone();
    let alpha = f.owner("Alpha")?;
    let scene = f.host.view_scene(1, "model-view", None, None)?;
    assert_eq!(scene.scene.graph()?.nodes.len(), 1);
    assert_eq!(scene.scene.graph()?.nodes[0].binding.key, alpha);
    let request = json!({"revision":1,"viewKey":"structure-1","toolId":"box","ownerKey":outer,
        "scope":{"schemaVersion":1,"ops":[{"op":"addSeed","element":alpha}]},"arguments":{"name":"Created"}});
    let refused = call(&mut f.host, "views/prepareCommand", request.clone())?;
    assert_eq!(
        refused["code"], "edit.inapplicable",
        "a data-only document cannot grant a hidden canvas owner"
    );
    let mut request = request;
    request["viewKey"] = json!("model-view");
    request
        .as_object_mut()
        .ok_or("Invalid request")?
        .remove("scope");
    let prepared = call(&mut f.host, "views/prepareCommand", request.clone())?;
    assert!(
        prepared["patches"][0]["replacement"]
            .as_str()
            .ok_or("No prepared canvas edit")?
            .contains("box Created")
    );
    assert_eq!(f.loader_calls.get(), 2);
    call(
        &mut f.host,
        "views/abortCommand",
        json!({"token":prepared["token"]}),
    )?;
    mode.set(5);
    let space = f.host.view_catalog(1)?.views[1].owners[0].key.clone();
    request["ownerKey"] = json!(space);
    let refused = call(&mut f.host, "views/prepareCommand", request)?;
    assert_eq!(
        refused["code"], "edit.inapplicable",
        "a catalog owner still needs a matching rule and predicate"
    );
    assert_eq!(
        f.loader_calls.get(),
        2,
        "refused owners never invoke the candidate loader"
    );
    Ok(())
}

#[test]
fn readonly_lane_targets_refuse_before_source_generation_or_candidate_load() -> Result {
    let library = "space Library { lane Boundary; step ReadStep in Boundary; }";
    let mut f = Fixture::with_library(library)?;
    f.sources[1].text=json!({"schemaVersion":1,"key":"lanes","name":"Lanes","ruleSet":"harness.lanes-horizontal","scope":{"schemaVersion":1,"ops":[]}}).to_string();
    let analysis = f.analyze(1, false)?;
    assert_eq!(analysis["clean"], true, "{analysis}");
    let scope = json!({"schemaVersion":1,"ops":[{"op":"addSeed","element":f.owner("Library")?}]});
    let response = call(
        &mut f.host,
        "views/scene",
        json!({"revision":1,"viewKey":"lanes","scope":scope}),
    )?;
    let step = &response["scene"]["steps"][0];
    let lane = &response["scene"]["lanes"][0];
    assert_eq!(step["binding"]["readOnly"], true);
    let hint = call(
        &mut f.host,
        "views/laneTargets",
        json!({"revision":1,"viewKey":"lanes","toolId":"place-step","step":step["id"],"lane":lane["id"],"before":null,"end":null,"scope":scope}),
    )?;
    assert_eq!(hint["enabled"], false);
    assert!(
        hint["reason"]
            .as_str()
            .is_some_and(|s| s.contains("read-only"))
    );
    let before = f.loader_calls.get();
    let rejected = call(
        &mut f.host,
        "views/prepareCommand",
        json!({"revision":1,"viewKey":"lanes","toolId":"place-step","ownerKey":step["binding"]["key"],"scope":scope,"arguments":{"step":step["id"],"lane":lane["id"],"before":"","end":""}}),
    )?;
    assert_eq!(rejected["code"], "lane.inapplicable");
    assert_eq!(f.loader_calls.get(), before);
    assert_eq!(f.host.source(LIBRARY_URI), Some(library));
    Ok(())
}
