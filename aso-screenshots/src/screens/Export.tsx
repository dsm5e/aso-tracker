import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, FolderOpen, AlertCircle, Loader2, StopCircle, FolderSearch, RefreshCw } from 'lucide-react';
import { Button, Card, Input } from '../components/shared';
import { useStudio } from '../state/studio';
import { renderAll, pickOutputFolder, type RenderFailure } from '../lib/exportRender';

/**
 * Phase 7 placeholder + project archive flow. Real PNG render via Playwright
 * is on the todo list — for now Finish & archive snapshots the project into
 * `archivedProjects` and resets active state so the user lands fresh in Setup.
 */
export function ExportScreen() {
  const nav = useNavigate();
  const appName = useStudio((s) => s.appName);
  const outputFolder = useStudio((s) => s.outputFolder);
  const screenshots = useStudio((s) => s.screenshots);
  const setProject = useStudio((s) => s.setProject);
  const archiveCurrentProject = useStudio((s) => s.archiveCurrentProject);
  const loadedFromProjectId = useStudio((s) => s.loadedFromProjectId);
  const locales = useStudio((s) => s.locales);

  const filenamePattern = useStudio((s) => s.filenamePattern);
  const setExport = useStudio((s) => s.setExport);

  const [archived, setArchived] = useState(false);
  const [renderState, setRenderState] = useState<{ done: number; total: number; current: string } | null>(null);
  const [renderResult, setRenderResult] = useState<{ rendered: number; failed: number; failures: RenderFailure[] } | null>(null);
  const stopRef = useRef(false);

  const slotCount = screenshots.length;
  const heroDone = screenshots.filter((s) => s.kind === 'action' && s.action?.aiImageUrl).length;
  const heroPresent = screenshots.some((s) => s.kind === 'action');
  const regulars = screenshots.filter((s) => s.kind === 'regular');
  const polishedRegulars = regulars.filter((s) => s.action?.aiImageUrl).length;
  const allTranslated = locales.length === 0 || locales.every((l) => l.aiTranslated);

  // Validation — what's missing before the user can archive cleanly.
  const issues: string[] = [];
  if (!appName.trim()) issues.push('App name is empty');
  if (!outputFolder.trim()) issues.push('Output folder not set');
  if (slotCount === 0) issues.push('No screenshots in the project');
  if (!heroPresent) issues.push('No hero slot — add one in Editor');
  if (heroPresent && heroDone === 0) issues.push('Hero hasn\'t been generated yet — Enhance in Editor first');
  if (regulars.length > 0 && polishedRegulars < regulars.length) {
    issues.push(`${regulars.length - polishedRegulars} regular slot(s) not polished — finish in AI Polish or skip`);
  }
  if (locales.length > 0 && !allTranslated) {
    issues.push(`${locales.filter((l) => !l.aiTranslated).length} locale(s) not translated — finish in Locales`);
  }
  // Polish skip is allowed (warning), but missing app name / folder / hero blocks.
  const blockingIssues = issues.filter((i) =>
    i.includes('App name') || i.includes('Output folder') || i.includes('No screenshots') || i.includes('No hero') || i.includes('Hero hasn\'t')
  );

  const totalToRender = (locales.length > 0 ? locales.length : 1) * screenshots.length;

  /** Single export flow: render PNGs → ask if user wants to archive → either
   *  archive + go to /setup (which surfaces it under Recent) or stay here. */
  const runRender = async (onlyJobs?: Array<{ slotId: string; localeCode: string | null }>) => {
    if (renderState) return;
    stopRef.current = false;
    if (!onlyJobs) setRenderResult(null);
    const total = onlyJobs?.length ?? totalToRender;
    setRenderState({ done: 0, total, current: 'starting…' });
    let res: Awaited<ReturnType<typeof renderAll>> | null = null;
    try {
      res = await renderAll({
        outputFolder,
        filenamePattern,
        perLocaleFolder: true,
        shouldStop: () => stopRef.current,
        onProgress: (done, total, current) => {
          setRenderState({ done, total, current });
        },
        onlyJobs,
      });
      // Retry merges with prior result so the user sees the cumulative state.
      if (onlyJobs && renderResult) {
        const successSlotLocale = new Set(res.files.map((p) => p)); // tracked by file path; keep simple
        void successSlotLocale;
        const retriedSucceeded = res.rendered;
        const remainingFailures = res.failures;
        setRenderResult({
          rendered: renderResult.rendered + retriedSucceeded,
          failed: remainingFailures.length,
          failures: remainingFailures,
        });
      } else {
        setRenderResult(res);
      }
    } finally {
      setRenderState(null);
    }
    if (!res) return;
    if (stopRef.current || res.rendered === 0) return;
    if (onlyJobs) return; // retry path: no archive prompt
    // Don't auto-confirm if there were failures — user should see the list,
    // hit Retry, and then manually choose to archive once everything's clean.
    if (res.failed > 0) return;
    const appSlug = (useStudio.getState().appName || 'app').replace(/\s+/g, '-');
    const summary = `${res.rendered} PNG${res.rendered === 1 ? '' : 's'} saved to ${outputFolder}/${appSlug}/images/ (iPhone) and /images-ipad/ (iPad).`;
    if (window.confirm(`${summary}\n\nЗавершить проект и сохранить в Recent?`)) {
      archiveCurrentProject();
      setArchived(true);
      setTimeout(() => nav('/setup'), 1500);
    }
  };

  const onFinishNow = () => {
    if (!renderResult || renderResult.rendered === 0) return;
    archiveCurrentProject();
    setArchived(true);
    setTimeout(() => nav('/setup'), 1500);
  };

  const onExport = () => runRender();
  const onRetryFailed = () => {
    if (!renderResult || renderResult.failures.length === 0) return;
    const jobs = renderResult.failures.map((f) => ({
      slotId: f.slotId,
      localeCode: f.localeCode === 'en' && locales.length === 0 ? null : f.localeCode,
    }));
    runRender(jobs);
  };

  const onStopRender = () => { stopRef.current = true; };

  const onPickFolder = async () => {
    try {
      const picked = await pickOutputFolder();
      if (picked) setProject({ outputFolder: picked });
    } catch (e) {
      alert(`Folder picker failed: ${(e as Error).message}\n\nType the path manually.`);
    }
  };

  if (archived) {
    return (
      <div style={{ padding: 'var(--s-9)', maxWidth: 600, margin: '0 auto', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <CheckCircle2 size={56} style={{ color: 'var(--ok, #10B981)' }} />
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Archived ✓</h1>
        <p style={{ color: 'var(--fg-2)', fontSize: 13, margin: 0 }}>
          {appName || 'Untitled'} saved to Recent. Returning to Setup…
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: 'var(--s-7)', maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <header>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>Export</h1>
        <p style={{ margin: '6px 0 0', color: 'var(--fg-2)', fontSize: 13 }}>
          PNG render via Playwright + ASC upload land in a future build. For now, finish the project here to archive it into Setup → Recent.
        </p>
      </header>

      <Card>
        <Card.Section title="Output folder">
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <Input
                placeholder="~/Desktop"
                value={outputFolder}
                onChange={(e) => setProject({ outputFolder: e.target.value })}
                hint="Pick a parent folder. iPhone slots → images/<locale>/, iPad slots → images-ipad/<locale>/."
              />
            </div>
            <Button
              variant="ghost"
              onClick={onPickFolder}
              leftIcon={<FolderSearch size={13} />}
              title="Pick a folder via the macOS native dialog"
              style={{ flex: 'none', marginTop: 4 }}
            >
              Browse…
            </Button>
          </div>
        </Card.Section>

        <Card.Section title="Project summary">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--fg-1)' }}>
            <div>App: <strong>{appName || '(untitled)'}</strong></div>
            <div>Slots: {slotCount} ({regulars.length} regular + {heroPresent ? '1 hero' : '0 hero'})</div>
            <div>Hero rendered: {heroDone === 1 ? '✓ yes' : '— no'}</div>
            <div>Polished regulars: {polishedRegulars} / {regulars.length}</div>
            <div>Locales: {locales.length} ({locales.filter((l) => l.aiTranslated).length} translated)</div>
            {loadedFromProjectId && (
              <div style={{ color: 'var(--fg-3)', marginTop: 4 }}>
                Editing existing archived project — Finish will update the same entry.
              </div>
            )}
          </div>
        </Card.Section>

        {issues.length > 0 && (
          <Card.Section title="Pre-flight checks">
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--fg-1)', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {issues.map((issue) => (
                <li key={issue} style={{ color: blockingIssues.includes(issue) ? 'var(--neg)' : 'var(--fg-2)', display: 'flex', alignItems: 'flex-start', gap: 6, listStyle: 'none', marginLeft: -14 }}>
                  <AlertCircle size={12} style={{ flex: 'none', marginTop: 2 }} />
                  {issue}{blockingIssues.includes(issue) ? '' : ' (warning, won\'t block archive)'}
                </li>
              ))}
            </ul>
          </Card.Section>
        )}

        <Card.Section title="Filename pattern">
          <Input
            placeholder="{app}_{locale}_{n}_{size}.{ext}"
            value={filenamePattern}
            onChange={(e) => setExport({ filenamePattern: e.target.value })}
            hint="Placeholders: {app}, {locale}, {n}, {size}, {ext}. Each PNG lands in <folder>/<locale>/."
          />
        </Card.Section>

        {renderState && (
          <Card.Section title="Rendering PNGs…">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: 'var(--fg-1)' }}>
              <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', color: 'var(--ai)' }} />
              <span>{renderState.done} / {renderState.total} done</span>
              <div style={{ flex: 1, height: 4, background: 'var(--bg-2)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${(renderState.done / Math.max(1, renderState.total)) * 100}%`, height: '100%', background: 'var(--ai)', transition: 'width .2s' }} />
              </div>
            </div>
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--fg-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {renderState.current}
            </div>
          </Card.Section>
        )}

        {renderResult && !renderState && (
          <Card.Section
            title="Last render"
            rightSlot={
              <div style={{ display: 'flex', gap: 6 }}>
                {renderResult.failures.length > 0 && (
                  <Button variant="ai" onClick={onRetryFailed} leftIcon={<RefreshCw size={12} />}>
                    Retry {renderResult.failures.length} failed
                  </Button>
                )}
                {renderResult.rendered > 0 && (
                  <Button variant="primary" onClick={onFinishNow} title="Archive project to Recent">
                    Finish & archive
                  </Button>
                )}
              </div>
            }
          >
            <div style={{ fontSize: 12, color: 'var(--fg-1)' }}>
              <CheckCircle2 size={14} style={{ verticalAlign: 'middle', color: 'var(--ok, #10B981)', marginRight: 6 }} />
              {renderResult.rendered} rendered{renderResult.failed > 0 ? ` · ` : ''}
              {renderResult.failed > 0 && (
                <span style={{ color: 'var(--neg)' }}>{renderResult.failed} failed</span>
              )}
              <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 4 }}>
                Saved to <code>{outputFolder}/{(appName || 'app').replace(/\s+/g, '-')}/images[-ipad]/&lt;locale&gt;/</code>
              </div>
            </div>
            {renderResult.failures.length > 0 && (
              <div style={{ marginTop: 10, padding: 10, background: 'var(--bg-2)', borderRadius: 6, maxHeight: 220, overflowY: 'auto' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--neg)', marginBottom: 6 }}>Failures (click Retry to re-run):</div>
                <ul style={{ margin: 0, padding: 0, fontSize: 11, color: 'var(--fg-2)', display: 'flex', flexDirection: 'column', gap: 6, listStyle: 'none' }}>
                  {renderResult.failures.map((f, i) => (
                    <li key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: 6, background: 'var(--bg-1)', borderRadius: 4 }}>
                      <span style={{ color: 'var(--fg-0)', fontWeight: 500 }}>
                        <span style={{ color: 'var(--accent)' }}>{f.localeCode}</span> · {f.slotVerb}
                      </span>
                      <span style={{ color: 'var(--fg-2)', fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>{f.error}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card.Section>
        )}
      </Card>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <Button variant="ghost" onClick={() => nav('/locales')} disabled={!!renderState}>← Locales</Button>
        {renderState ? (
          <Button variant="ghost" onClick={onStopRender} leftIcon={<StopCircle size={14} />}>
            Stop
          </Button>
        ) : (
          <Button
            variant="primary"
            size="lg"
            leftIcon={<FolderOpen size={14} />}
            onClick={onExport}
            disabled={blockingIssues.length > 0}
            title={blockingIssues.length ? `Fix: ${blockingIssues.join(' · ')}` : `Render ${totalToRender} PNGs — iPhone slots → images/ (1290×2796), iPad slots → images-ipad/ (2048×2732)`}
          >
            Export
          </Button>
        )}
      </div>
    </div>
  );
}
