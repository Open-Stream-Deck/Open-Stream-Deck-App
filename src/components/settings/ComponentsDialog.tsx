import { useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import { invoke } from "@tauri-apps/api/core";
import { type Key, t } from "../../i18n";
import { Modal } from "../ui/Modal";
import { ScrollArea } from "../ui/ScrollArea";
import { Select } from "../ui/Select";
import { PluginIcon } from "../ui/pluginIcons";
import { ArrowLeft, ArrowRight, Box, ChevronDown, DocumentText, FolderOpen, Info, TickCircle } from "../ui/icons";

type Platform = { os: "windows" | "linux" | "macos"; arch: "x86_64" | "aarch64" };
type Target = { id: string; name: string; selection: "directory" | "executable"; os?: Platform["os"]; after_install?: string };
type Component = { id: string; name: string; description: string; version: string; targets: string[] };
type Installation = {
  id: string; plugin: string; component: string; target: string; version: string; root: string;
  status: "installed" | "modified" | "unavailable" | "update_available";
};
type Overview = {
  manifest: { name: string; author: string; components?: Component[]; targets?: Target[] } | null;
  installations: Installation[];
  recovery: boolean;
  platform: Platform | null;
  compatible_components: string[];
};
type Plan = {
  id: string; component: string; target: string; root: string; version: string; conflicts: boolean; uninstall: boolean;
  changes: { path: string; action: "create" | "skip" | "update" | "conflict" | "restore" | "remove" }[];
};
type Step = "select" | "location" | "review" | "done" | "manage";
type Operation = "load" | "pick" | "plan" | "apply" | "export" | "recover";
type Result = { removing: boolean; instruction: string };
type DialogError = { title: Key; hint?: Key; details: string };
const ACTIONS: Record<Plan["changes"][number]["action"], Key> = {
  create: "components.create", skip: "components.skip", update: "components.update",
  conflict: "components.conflict", restore: "components.restore", remove: "components.delete",
};
const ERRORS: Record<Operation, Key> = {
  load: "components.loadFailed", pick: "components.pickFailed", plan: "components.planFailed",
  apply: "components.applyFailed", export: "components.exportFailed", recover: "components.recoverFailed",
};
const STEPS: Key[] = ["components.stepApp", "components.stepFolder", "components.stepReview"];
const SYSTEM_NAMES = { windows: "Windows", linux: "Linux", macos: "macOS" };

function displayPath(path: string) {
  return path.replace(/^\\\\\?\\/, "");
}

function describeError(kind: Operation, cause: unknown): DialogError {
  const details = String(cause);
  if (/changed; review|Plan expired/.test(details)) {
    return { title: "components.staleTitle", hint: "components.staleHint", details };
  }
  if (details.startsWith("Close the target application")) {
    return { title: "components.runningTitle", hint: "components.runningHint", details };
  }
  if (/Selected directory is missing|Select an existing absolute/.test(details)) {
    return { title: "components.folderTitle", hint: "components.folderHint", details };
  }
  if (/os error (1|5|13)\b/.test(details)) {
    return { title: "components.accessTitle", hint: "components.accessHint", details };
  }
  if (kind === "load") return { title: ERRORS.load, hint: "components.loadHint", details };
  return { title: ERRORS[kind], details };
}

export function ComponentsDialog({ plugin, icon, onClose }: { plugin: string | null; icon?: string; onClose: () => void }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [step, setStep] = useState<Step>("select");
  const [componentId, setComponentId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [root, setRoot] = useState("");
  const [candidates, setCandidates] = useState<string[]>([]);
  const [finding, setFinding] = useState(false);
  const [searchRevision, setSearchRevision] = useState(0);
  const [loadRevision, setLoadRevision] = useState(0);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [conflicts, setConflicts] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [busy, setBusy] = useState<Operation | null>(null);
  const [error, setError] = useState<DialogError | null>(null);
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const generation = useRef(0);
  const operation = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const filesId = useId();
  const identity = useRef({ plugin, icon });
  if (plugin !== null) identity.current = { plugin, icon };
  const declaredComponents = overview?.manifest?.components ?? [];
  const components = declaredComponents.filter((item) => overview?.compatible_components.includes(item.id));
  const unsupported = declaredComponents.filter((item) => !overview?.compatible_components.includes(item.id));
  const component = components.find((item) => item.id === componentId);
  const targets = overview?.manifest?.targets?.filter((item) => component?.targets.includes(item.id) && (!item.os || item.os === overview.platform?.os)) ?? [];
  const target = targets.find((item) => item.id === targetId);
  const reviewedComponent = components.find((item) => item.id === plan?.component);
  const reviewedTarget = overview?.manifest?.targets?.find((item) => item.id === plan?.target);
  const canSetup = components.length > 0 && !overview?.recovery;
  const wizard = components.length > 0 && !overview?.recovery && (step === "select" || step === "location" || (step === "review" && !plan?.uninstall));
  const platformName = overview?.platform ? `${SYSTEM_NAMES[overview.platform.os]} / ${overview.platform.arch === "aarch64" ? "ARM64" : "x64"}` : t("components.unknownPlatform");
  let stepIndex = 2;
  if (step === "select") stepIndex = 0;
  else if (step === "location") stepIndex = 1;

  useLayoutEffect(() => {
    const request = ++generation.current;
    if (plugin === null) return;
    operation.current = false;
    setOverview(null);
    setPlan(null);
    setResult(null);
    setRoot("");
    setError(null);
    setNotice("");
    setComponentId("");
    setTargetId("");
    setCandidates([]);
    setConflicts(false);
    setFilesOpen(false);
    setBusy(null);
    const previousFocus = document.activeElement;
    setBusy("load");
    invoke<Overview>("plugin_components", { request: { action: "overview", id: plugin } })
      .then((value) => {
        if (generation.current !== request) return;
        setOverview(value);
        const available = value.manifest?.components?.filter((item) => value.compatible_components.includes(item.id)) ?? [];
        const onlyComponent = available.length === 1 ? available[0] : undefined;
        const availableTargets = value.manifest?.targets?.filter((item) => onlyComponent?.targets.includes(item.id) && (!item.os || item.os === value.platform?.os)) ?? [];
        const onlyTarget = availableTargets.length === 1 ? availableTargets[0].id : "";
        setComponentId(onlyComponent?.id ?? "");
        setTargetId(onlyTarget);
        if (value.installations.length || !value.manifest?.components?.length || value.recovery) setStep("manage");
        else setStep(onlyTarget ? "location" : "select");
      })
      .catch((cause: unknown) => {
        if (generation.current === request) setError(describeError("load", cause));
      })
      .finally(() => { if (generation.current === request) setBusy(null); });
    return () => {
      generation.current++;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [plugin, loadRevision]);

  useEffect(() => {
    if (plugin === null || !targetId || step !== "location") return;
    let active = true;
    setFinding(true);
    setCandidates([]);
    invoke<string[]>("plugin_components", { request: { action: "discover", id: plugin, target: targetId } })
      .then((paths) => {
        if (!active) return;
        setCandidates(paths);
        if (paths.length === 1) setRoot((selected) => selected || paths[0]);
      })
      .catch((cause: unknown) => {
        if (active) setError({ title: "components.searchFailed", details: String(cause) });
      })
      .finally(() => { if (active) setFinding(false); });
    return () => { active = false; };
  }, [plugin, targetId, searchRevision, step]);

  useEffect(() => { if (overview) heading.current?.focus(); }, [step, !!overview]);

  async function run(kind: Operation, task: (active: () => boolean) => Promise<void>) {
    if (operation.current || busy) return;
    const request = generation.current;
    const active = () => generation.current === request;
    operation.current = true;
    setBusy(kind);
    setError(null);
    setNotice("");
    try {
      await task(active);
    } catch (cause) {
      if (!active()) return;
      setError(describeError(kind, cause));
      if (kind === "apply") {
        setStep(plan?.uninstall ? "manage" : "location");
        setPlan(null);
        setConflicts(false);
        try {
          const value = await invoke<Overview>("plugin_components", { request: { action: "overview", id: plugin } });
          if (active()) setOverview(value);
        } catch (refreshError) {
          if (active()) setError({ title: ERRORS.load, details: `${String(cause)}\n${String(refreshError)}` });
        }
      }
    } finally {
      if (active()) {
        operation.current = false;
        setBusy(null);
      }
    }
  }

  function selectComponent(id: string) {
    const next = components.find((item) => item.id === id);
    const nextTargets = overview?.manifest?.targets?.filter((item) => next?.targets.includes(item.id) && (!item.os || item.os === overview.platform?.os)) ?? [];
    setComponentId(id);
    setTargetId(nextTargets.length === 1 ? nextTargets[0].id : "");
    setRoot("");
    setCandidates([]);
    setError(null);
  }

  function close() {
    if (!operation.current && busy !== "load") onClose();
  }

  function pickFolder() {
    if (!target) return;
    void run("pick", async (active) => {
      const { open } = await import("@tauri-apps/plugin-dialog");
      if (!active()) return;
      const selected = await open({ title: t(target.selection === "executable" ? "components.chooseExecutableFor" : "components.chooseFor", { name: target.name }), directory: target.selection === "directory", multiple: false });
      if (!active() || typeof selected !== "string") return;
      setRoot(target.selection === "executable" ? selected.replace(/[\\/][^\\/]+$/, "") : selected);
      setPlan(null);
    });
  }

  function preparePlan() {
    void run("plan", async (active) => {
      const value = await invoke<Plan>("plugin_components", { request: { action: "plan", id: plugin, component: componentId, target: targetId, root } });
      if (!active()) return;
      setPlan(value);
      setFilesOpen(value.conflicts);
      setConflicts(false);
      setStep("review");
    });
  }

  function removeInstallation(installation: Installation) {
    void run("plan", async (active) => {
      const value = await invoke<Plan>("plugin_components", { request: { action: "remove", installation: installation.id } });
      if (!active()) return;
      setPlan(value);
      setFilesOpen(value.conflicts);
      setConflicts(false);
      setStep("review");
    });
  }

  function applyPlan() {
    if (!plan) return;
    const approved = plan;
    const instruction = reviewedTarget?.after_install ?? t("components.finished");
    void run("apply", async (active) => {
      await invoke("plugin_components", { request: { action: "apply", plan: approved.id, replace_conflicts: conflicts } });
      if (!active()) return;
      setResult({ removing: approved.uninstall, instruction });
      setPlan(null);
      setStep("done");
      try {
        const value = await invoke<Overview>("plugin_components", { request: { action: "overview", id: plugin } });
        if (active()) setOverview(value);
      } catch (cause) {
        if (active()) setError(describeError("load", cause));
      }
    });
  }

  function exportFiles() {
    if (!component) return;
    void run("export", async (active) => {
      const { save } = await import("@tauri-apps/plugin-dialog");
      if (!active()) return;
      const output = await save({ defaultPath: `${component.id}-${component.version}.zip`, filters: [{ name: "ZIP", extensions: ["zip"] }] });
      if (!active() || !output) return;
      await invoke("plugin_components", { request: { action: "export", id: plugin, component: component.id, output } });
      if (active()) setNotice(t("components.exported"));
    });
  }

  function recover() {
    void run("recover", async (active) => {
      await invoke("plugin_components", { request: { action: "recover" } });
      const value = await invoke<Overview>("plugin_components", { request: { action: "overview", id: plugin } });
      if (!active()) return;
      setOverview(value);
      setNotice(t("components.recovered"));
    });
  }

  function back() {
    setError(null);
    setNotice("");
    if (step === "review") {
      setStep(plan?.uninstall ? "manage" : "location");
      setPlan(null);
    } else if (step === "location") setStep("select");
    else setStep("manage");
  }

  let title: Key = "components.selectTitle";
  if (overview?.recovery) title = "components.recoveryTitle";
  else if (step === "location") title = "components.locationTitle";
  else if (step === "review") title = plan?.uninstall ? "components.removeTitle" : "components.reviewTitle";
  else if (step === "done") title = result?.removing ? "components.removed" : "components.doneTitle";
  else if (step === "manage") title = "components.manageTitle";
  else if (overview && declaredComponents.length > 0 && !components.length) title = "components.unsupportedTitle";

  let secondaryAction: Key = "components.later";
  if (step === "done") secondaryAction = "components.manage";
  else if (step === "manage" || !overview || !components.length) secondaryAction = "common.close";
  let locationAction: Key = "components.next";
  if (!root) locationAction = target?.selection === "executable" ? "components.chooseExecutable" : "components.choose";
  else if (busy === "plan") locationAction = "components.checking";
  let applyAction: Key = plan?.uninstall ? "components.remove" : "components.install";
  if (busy === "apply") applyAction = plan?.uninstall ? "components.removing" : "components.installing";

  return (
    <Modal open={plugin !== null} onClose={close} label={t("components.title")} class={!wizard && step !== "done" ? "components-dialog components-dialog--compact" : "components-dialog"}>
      <div class="store-details__head components-dialog__head">
        <span class="components-dialog__icon">{identity.current.plugin && identity.current.icon ? <PluginIcon pluginId={identity.current.plugin} src={identity.current.icon} /> : <Box size={24} />}</span>
        <div class="store-details__title">
          <h2>{t("components.title")}</h2>
          <span>{overview?.manifest ? `${overview.manifest.name} · ${overview.manifest.author}` : t("components.manageHint")}</span>
        </div>
      </div>
      {overview && wizard && <ol class="components-dialog__steps" aria-label={t("components.stepsLabel")}>
        {STEPS.map((label, index) => <li key={label} class={index <= stepIndex ? "components-dialog__step components-dialog__step--active" : "components-dialog__step"} aria-current={index === stepIndex ? "step" : undefined}>
          <span>{index < stepIndex ? <TickCircle size={14} /> : index + 1}</span>{t(label)}
        </li>)}
      </ol>}
      <ScrollArea class="components-dialog__body">
        <div class={step === "done" ? "components-dialog__content components-dialog__content--done" : "components-dialog__content"}>
          <div key={step} class="components-dialog__stage">
            {!overview && busy === "load" && <div class="components-dialog__loading" role="status"><span class="spinner" />{t("components.loading")}</div>}
            {overview && <>
              <div class={step === "done" ? "components-dialog__intro components-dialog__intro--done" : "components-dialog__intro"}>
                <h3 ref={heading} tabIndex={-1}>{t(title)}</h3>
                {overview.recovery ? <p>{t("components.recoveryHint")}</p> : <>
                  {step === "select" && components.length > 0 && <p>{t("components.selectHint")}</p>}
                  {step === "location" && <p>{t(target?.selection === "executable" ? "components.executableHint" : "components.locationHint", { name: target?.name ?? "" })}</p>}
                  {step === "review" && <p>{t(plan?.uninstall ? "components.removeHint" : "components.reviewHint")}</p>}
                  {step === "done" && <p>{result?.removing ? t("components.removeDoneHint") : result?.instruction}</p>}
                  {step === "manage" && <p>{t("components.manageDescription")}</p>}
                </>}
              </div>
              {!overview.recovery && <>
                {(step === "select" || step === "manage") && unsupported.length > 0 && <div class="components-dialog__note"><Info size={18} /><p>{t("components.unsupportedHint", { names: unsupported.map((item) => item.name).join(", "), platform: platformName })}</p></div>}
                {step === "select" && components.length > 0 && <fieldset disabled={!!busy} class="components-dialog__fields">
                  {components.length > 1 && <div class="components-dialog__field"><span>{t("components.component")}</span>
                    <Select value={componentId} label={t("components.component")} options={[{ value: "", label: t("components.selectComponent") }, ...components.map((item) => ({ value: item.id, label: item.name }))]} onChange={(value) => selectComponent(String(value))} />
                  </div>}
                  {component && <div class="components-dialog__component"><strong>{component.name} <span>v{component.version}</span></strong><p>{component.description}</p></div>}
                  {component && <div class="components-dialog__field"><span>{t("components.application")}</span>
                    <Select value={targetId} label={t("components.application")} options={[{ value: "", label: t("components.selectApp") }, ...targets.map((item) => ({ value: item.id, label: item.name }))]} onChange={(value) => { setTargetId(String(value)); setRoot(""); setError(null); }} />
                  </div>}
                </fieldset>}
                {step === "location" && <>
                  {finding && <p class="components-dialog__search" role="status"><span class="spinner" />{t("components.searching")}</p>}
                  {!finding && !root && <div class="components-dialog__note"><Info size={18} /><p>{t("components.notFound")}</p></div>}
                  {candidates.length > 1 && <fieldset disabled={!!busy} class="components-dialog__fields"><div class="components-dialog__field"><span>{t("components.foundLocations")}</span>
                    <Select value={root} label={t("components.foundLocations")} options={[{ value: "", label: t("components.selectLocation") }, ...candidates.map((path) => ({ value: path, label: displayPath(path) }))]} onChange={(value) => { setRoot(String(value)); setError(null); }} />
                  </div></fieldset>}
                  {root && <div class="components-dialog__destination"><div><strong>{target?.name}</strong><span>{displayPath(root)}</span></div>
                    <button type="button" class="icon-button" disabled={!!busy} aria-label={t("components.changeLocation")} data-tip={t("components.changeLocation")} onClick={pickFolder}><FolderOpen size={16} /></button>
                  </div>}
                  <div class="components-dialog__links">
                    <button type="button" disabled={!!busy || finding} onClick={() => { setError(null); setSearchRevision((value) => value + 1); }}>{t("components.searchAgain")}</button>
                    <button type="button" disabled={!!busy} onClick={exportFiles}>{t("components.manual")}</button>
                  </div>
                </>}
                {step === "review" && plan && <>
                  <div class="components-dialog__component"><strong>{reviewedComponent?.name ?? plan.component} <span>v{plan.version}</span></strong><p>{reviewedTarget?.name}</p></div>
                  <div class="components-dialog__destination"><div><span>{t("components.destination")}</span><strong class="components-dialog__path">{displayPath(plan.root)}</strong></div></div>
                  {plan.conflicts && <div class="components-dialog__note components-dialog__note--warning"><Info size={18} /><p>{t("components.conflictHint")}</p></div>}
                  <section class="components-dialog__files">
                    <button type="button" class="components-dialog__files-trigger" aria-expanded={filesOpen} aria-controls={filesId} onClick={() => setFilesOpen((open) => !open)}>
                      <DocumentText size={16} />
                      {t("components.fileCount", { count: plan.changes.length })}
                      <ChevronDown class="components-dialog__disclosure" size={14} />
                    </button>
                    <div id={filesId} class="components-dialog__files-body" data-open={filesOpen} aria-hidden={!filesOpen} inert={!filesOpen}>
                      <div>
                        <ul>{plan.changes.map((change) => (
                          <li key={change.path}>
                            <span>{change.path}</span>
                            <span class={change.action === "conflict" ? "components-dialog__action components-dialog__action--conflict" : "components-dialog__action"}>{t(ACTIONS[change.action])}</span>
                          </li>
                        ))}</ul>
                      </div>
                    </div>
                  </section>
                  {!plan.uninstall && <div class="components-dialog__note"><p>{t("components.warning")}</p></div>}
                  {plan.conflicts && <label class="components-dialog__consent"><input type="checkbox" checked={conflicts} disabled={!!busy} onChange={(event) => setConflicts(event.currentTarget.checked)} /><span>{t("components.conflicts")}</span></label>}
                </>}
                {step === "manage" && <>
                  {!overview.installations.length && <div class="components-dialog__empty"><Box size={24} /><p>{t("components.empty")}</p></div>}
                  {overview.installations.map((installation) => {
                    const definition = declaredComponents.find((item) => item.id === installation.component);
                    const application = overview.manifest?.targets?.find((item) => item.id === installation.target);
                    return <div key={installation.id} class="components-dialog__installation">
                      <div class="components-dialog__installation-head">
                        <div><strong>{definition?.name ?? installation.component}</strong><span>{application?.name ?? installation.plugin} · v{installation.version}</span></div>
                        <button type="button" class="button button--danger" disabled={!!busy} onClick={() => removeInstallation(installation)}>{t("components.remove")}</button>
                      </div>
                      <p class="components-dialog__path">{displayPath(installation.root)}</p>
                      {installation.status !== "installed" && <span class={`components-dialog__status components-dialog__status--${installation.status}`}>{t(`components.${installation.status}`)}</span>}
                      {definition && overview.compatible_components.includes(definition.id) && <div class="components-dialog__installation-actions">
                        <button type="button" class="button" disabled={!!busy} onClick={() => { setComponentId(installation.component); setTargetId(installation.target); setRoot(installation.root); setStep("location"); setError(null); }}>{t(installation.status === "update_available" ? "components.update" : "components.configure")}</button>
                      </div>}
                    </div>;
                  })}
                </>}
              </>}
            </>}
            {notice && <div class="components-dialog__note components-dialog__note--success" role="status"><TickCircle size={18} /><p>{notice}</p></div>}
            {error && (
              <div class="components-dialog__error" role="alert">
                <strong>{t(error.title)}</strong>
                <p>{t(error.hint ?? "components.errorHint")}</p>
                <details>
                  <summary>{t("components.errorDetails")}<ChevronDown class="components-dialog__disclosure" size={14} /></summary>
                  <p>{error.details}</p>
                </details>
              </div>
            )}
          </div>
        </div>
      </ScrollArea>
      <div class="store-details__footer components-dialog__footer">
        {overview?.recovery ? (
          <>
            <button type="button" class="button" disabled={!!busy} onClick={close}>{t("common.close")}</button>
            <button type="button" class="button button--primary" disabled={!!busy} onClick={recover}>
              {busy && <span class="spinner" />}
              {t("components.recover")}
            </button>
          </>
        ) : (
          <>
            {(step === "location" || step === "review") && overview ? (
              <button type="button" class="button" disabled={!!busy} onClick={back}>
                <ArrowLeft size={15} />{t("components.back")}
              </button>
            ) : (
              <button type="button" class="button" disabled={!!busy} onClick={step === "done" ? () => { setStep("manage"); setError(null); } : close}>
                {t(secondaryAction)}
              </button>
            )}
            {!overview && error && <button type="button" class="button button--primary" onClick={() => setLoadRevision((value) => value + 1)}>{t("components.retry")}</button>}
            {overview && <>
              {step === "select" && components.length > 0 && (
                <button type="button" class="button button--primary" disabled={!!busy || !target} onClick={() => setStep("location")}>
                  {t("components.next")}<ArrowRight size={15} />
                </button>
              )}
              {step === "location" && (
                <button type="button" class="button button--primary" disabled={!!busy} onClick={root ? preparePlan : pickFolder}>
                  {busy && <span class="spinner" />}
                  {t(locationAction)}
                  {!busy && <ArrowRight size={15} />}
                </button>
              )}
              {step === "review" && plan && (
                <button type="button" class="button button--primary" disabled={!!busy || (plan.conflicts && !conflicts)} onClick={applyPlan}>
                  {busy && <span class="spinner" />}{t(applyAction)}
                </button>
              )}
              {step === "done" && <button type="button" class="button button--primary" disabled={!!busy} onClick={close}>{t("components.done")}</button>}
              {step === "manage" && canSetup && (
                <button type="button" class="button button--primary" disabled={!!busy} onClick={() => {
                  setStep("select");
                  setTargetId("");
                  setRoot("");
                  setError(null);
                  setNotice("");
                }}>
                  {t("components.addConnection")}<ArrowRight size={15} />
                </button>
              )}
            </>}
          </>
        )}
      </div>
    </Modal>
  );
}
