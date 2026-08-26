// qm-runner — run a compiled .qm program on the REAL quilt-vm-rust (the 5
// opcodes as QuiltVM methods; nothing reimplemented). Signals are served the
// way cell-cascade's /signal pipeline serves sclerotic tissue: route to the
// target cell, first matching guard wins (kind equality + canonical-JSON
// subset payload match), miss = 'table-miss' scar tissue.
//
// The mapping onto the real VM:
//   bind   -> vm.bind(name, serde_json::Value)          (Value: 'static => Any)
//   link   -> vm.link(a, b, "signal:<kind>" | "lineage")
//   effect -> vm.effect(target, fwd, inv)               fwd applies the guard;
//             the VM queues it and TICK applies it — that drain IS the
//             rule-table step semantics
//   view   -> vm.view(target, viewer) downcast to Value; 'health' projects
//             the bound cell facts
//   tick   -> vm.tick(1.0) after each signal enqueue

use quilt_vm::QuiltVM;
use serde_json::{json, Value};
use std::collections::HashMap;

#[derive(serde::Deserialize)]
struct QmView {
    name: String,
    target: String,
    #[allow(dead_code)]
    project: String,
}

#[derive(serde::Deserialize)]
struct QmProgram {
    #[allow(dead_code)]
    organism: String,
    ops: Vec<QmOp>,
    #[allow(dead_code)]
    routes: HashMap<String, String>,
    #[serde(default)]
    views: Vec<QmView>,
}

#[derive(serde::Deserialize)]
#[serde(tag = "op", rename_all = "lowercase")]
enum QmOp {
    Bind { target: String, value: Value },
    Link { #[serde(rename = "from")] from: String, to: String, #[serde(rename = "type")] ty: String },
    Effect { target: String, guard: Guard, action: Action },
    View { target: String, viewer: String, project: String },
}

#[derive(serde::Deserialize, Clone)]
struct Guard {
    kind: Option<String>,
    payload_equals: Option<HashMap<String, Value>>,
}

#[derive(serde::Deserialize, Clone)]
#[serde(untagged)]
enum Action {
    Set { set: Value },
    Expr { expr: Expr },
}

#[derive(serde::Deserialize, Clone)]
struct Expr {
    op: String,
    features: String,
    centroid: String,
    sigma: String,
    #[allow(dead_code)]
    onto: Option<String>,
}

#[derive(serde::Deserialize)]
struct Signal {
    #[serde(default)]
    #[allow(dead_code)]
    from: Option<String>,
    to: String,
    kind: String,
    #[serde(default)]
    payload: HashMap<String, Value>,
}

/// Canonical JSON: sorted keys at every level — must match compile.ts canonJson.
fn canon(v: &Value) -> String {
    match v {
        Value::Object(m) => {
            let mut keys: Vec<&String> = m.keys().collect();
            keys.sort();
            let body: Vec<String> = keys
                .iter()
                .map(|k| format!("{}:{}", serde_json::to_string(k).unwrap(), canon(&m[*k])))
                .collect();
            format!("{{{}}}", body.join(","))
        }
        Value::Array(a) => {
            let body: Vec<String> = a.iter().map(canon).collect();
            format!("[{}]", body.join(","))
        }
        _ => serde_json::to_string(v).unwrap(),
    }
}

fn guard_matches(g: &Guard, kind: &str, payload: &HashMap<String, Value>) -> bool {
    if let Some(k) = &g.kind {
        if k != kind { return false; }
    }
    if let Some(pe) = &g.payload_equals {
        for (k, want) in pe {
            match payload.get(k) {
                Some(got) if canon(got) == canon(want) => {}
                _ => return false,
            }
        }
    }
    true
}

fn sigma_distance(f: &[Value], c: &[Value], s: &[Value]) -> Result<f64, String> {
    if f.len() != c.len() || f.len() != s.len() {
        return Err(format!("dimension mismatch: f={} c={} s={}", f.len(), c.len(), s.len()));
    }
    let mut acc = 0.0f64;
    for i in 0..f.len() {
        let (fv, cv, sv) = (
            f[i].as_f64().ok_or("feature not numeric")?,
            c[i].as_f64().ok_or("centroid not numeric")?,
            s[i].as_f64().filter(|x| *x != 0.0).ok_or("sigma zero/non-numeric")?,
        );
        let d = (fv - cv) / sv;
        acc += d * d;
    }
    Ok(acc.sqrt())
}

fn get_bound<'a>(vm: &'a QuiltVM, name: &str) -> Option<&'a Value> {
    vm.view(name, "anyone").and_then(|v| v.downcast_ref::<Value>())
}

fn main() {
    let mut args = std::env::args().skip(1);
    let prog_path = args.next().expect("usage: qm-runner <prog.qm> [signals.json]");
    let sig_path = args.next();

    let program: QmProgram = serde_json::from_str(&std::fs::read_to_string(&prog_path).unwrap())
        .expect("parse .qm");

    let mut vm = QuiltVM::new();

    // Execute the program ops. Effects are stored (guard + action) and applied
    // at signal time via vm.effect + vm.tick — the VM's pending_effects drain
    // is the rule-table step semantics.
    let mut effects: Vec<(String, Guard, Action)> = Vec::new();

    for op in &program.ops {
        match op {
            QmOp::Bind { target, value } => {
                // clone out of the borrow before handing to vm.bind
                vm.bind(target, value.clone());
            }
            QmOp::Link { from, to, ty } => {
                vm.link(from, to, ty);
            }
            QmOp::Effect { target, guard, action } => {
                effects.push((target.clone(), guard.clone(), action.clone()));
            }
            QmOp::View { .. } => { /* projections come from program.views */ }
        }
    }

    let mut served = Vec::new();
    if let Some(sp) = &sig_path {
        let signals: Vec<Signal> =
            serde_json::from_str(&std::fs::read_to_string(sp).unwrap()).expect("parse signals");
        for s in &signals {
            let matching: Vec<usize> = effects
                .iter()
                .enumerate()
                .filter(|(_, (t, g, _))| t == &format!("{}:response", s.to) && guard_matches(g, &s.kind, &s.payload))
                .map(|(i, _)| i)
                .collect();

            let mode;
            if let Some(&first) = matching.first() {
                mode = "table";
                let (target, _, action) = &effects[first];
                let result: Value = match action {
                    Action::Set { set } => set.clone(),
                    Action::Expr { expr } => {
                        let c = get_bound(&vm, &expr.centroid).cloned()
                            .ok_or_else(|| format!("{} not bound", expr.centroid)).unwrap();
                        let sg = get_bound(&vm, &expr.sigma).cloned()
                            .ok_or_else(|| format!("{} not bound", expr.sigma)).unwrap();
                        let empty = Vec::new();
                        let f = s.payload.get("features")
                            .and_then(|v| v.as_array()).unwrap_or(&empty);
                        let d = sigma_distance(f, c.as_array().unwrap(), sg.as_array().unwrap())
                            .expect("gate math");
                        json!({ "sigma_distance": d })
                    }
                };
                let result = result; // move
                let result_for_inverse = result.clone();
                // EFFECT + TICK on the real VM
                vm.effect(target,
                    Box::new(move |thing| { thing.value = Some(Box::new(result.clone())); }),
                    Box::new(move |thing| { thing.value = Some(Box::new(Value::Null)); }));
                let _ = &result_for_inverse;
                vm.tick(1.0);
                served.push(json!({ "to": s.to, "kind": s.kind, "mode": mode,
                    "response": get_bound(&vm, target).cloned().unwrap_or(Value::Null) }));
            } else {
                mode = "table-miss";
                let target = format!("{}:response", s.to);
                vm.effect(&target,
                    Box::new(|thing| { thing.value = Some(Box::new(json!({ "miss": true }))); }),
                    Box::new(|thing| { thing.value = Some(Box::new(Value::Null)); }));
                vm.tick(1.0);
                served.push(json!({ "to": s.to, "kind": s.kind, "mode": mode,
                    "response": get_bound(&vm, &target).cloned().unwrap_or(Value::Null) }));
            }
            let _ = mode;
        }
    }

    // Project the declared views off the live VM.
    let mut view_out = serde_json::Map::new();
    for v in &program.views {
        let val = get_bound(&vm, &v.target).cloned().unwrap_or(Value::Null);
        view_out.insert(v.name.clone(), val);
    }

    println!("{}", serde_json::to_string_pretty(&json!({
        "organism": program.organism, "time": vm.time, "results": served, "views": view_out,
    })).unwrap());
}
