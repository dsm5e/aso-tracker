import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Smartphone, Tablet, Layers, Plus, Trash2, FlaskConical, Shapes, ArrowRight } from 'lucide-react';
import { Button, Card, Input } from '../components/shared';
import { useStudio, type Devices, type ArchivedProject, type ArchivedPPOExperiment } from '../state/studio';
import { formatDimensions, getIPhoneProfile } from '../lib/deviceProfiles';

export function SetupScreen() {
  const nav = useNavigate();
  const devices = useStudio((s) => s.devices);
  const iphoneModel = useStudio((s) => s.iphoneModel);
  const outputFolder = useStudio((s) => s.outputFolder);
  const appName = useStudio((s) => s.appName);
  const setProject = useStudio((s) => s.setProject);
  const archivedProjects = useStudio((s) => s.archivedProjects);
  const archivedPPOExperiments = useStudio((s) => s.archivedPPOExperiments);
  const startNewProject = useStudio((s) => s.startNewProject);
  const loadProject = useStudio((s) => s.loadProject);
  const deleteProject = useStudio((s) => s.deleteProject);
  const ppoLoadSession = useStudio((s) => s.ppoLoadSession);
  const ppoDeleteSession = useStudio((s) => s.ppoDeleteSession);
  const screenshots = useStudio((s) => s.screenshots);
  const iconVariantCount = useStudio((s) => s.iconLab?.variants.length ?? 0);
  const iphoneProfile = getIPhoneProfile(iphoneModel);
  const deviceOptions: { value: Devices; label: string; sub: string; icon: typeof Smartphone }[] = [
    {
      value: 'iphone',
      label: 'iPhone',
      sub: `${iphoneProfile.label} · ${formatDimensions(iphoneProfile.canvas, '×')}`,
      icon: Smartphone,
    },
    { value: 'ipad', label: 'iPad', sub: '2048×2732 (13")', icon: Tablet },
    { value: 'both', label: 'Both', sub: `${iphoneProfile.label} + iPad`, icon: Layers },
  ];

  const hasActiveWork = !!appName || !!outputFolder || screenshots.length > 0;

  const onStartNew = () => {
    if (hasActiveWork && !window.confirm('Discard the current draft and start a new project? Unfinished work will be lost (use Export to archive it instead).')) return;
    startNewProject();
  };

  const onOpenRecent = (id: string) => {
    if (hasActiveWork && !window.confirm('Open archived project? Your current draft will be discarded — finish it via Export first if you want to keep it.')) return;
    loadProject(id);
    nav('/editor');
  };

  const onDeleteRecent = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!window.confirm('Delete this archived project? This cannot be undone.')) return;
    deleteProject(id);
  };

  const onOpenPPO = (id: string) => {
    ppoLoadSession(id);
    nav('/ppo');
  };

  const onDeletePPO = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!window.confirm('Delete this saved PPO session? This cannot be undone.')) return;
    ppoDeleteSession(id);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 'var(--s-9) var(--s-7)' }}>
      <div style={{ width: '100%', maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em' }}>
              {hasActiveWork ? (appName || 'Draft project') : 'New project'}
            </h1>
            <p style={{ margin: '8px 0 0', color: 'var(--fg-2)', fontSize: 13 }}>
              {hasActiveWork
                ? 'Editing in progress. Finish via Export to archive, or start over.'
                : 'Set the basics. You can change anything later.'}
            </p>
          </div>
          {hasActiveWork && (
            <Button variant="ghost" leftIcon={<Plus size={14} />} onClick={onStartNew} title="Discard draft and start fresh">
              Start over
            </Button>
          )}
        </header>

        <Card>
          <Card.Section title="Device targets">
            <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--fg-2)' }}>
              Generate at the largest size — App Store Connect auto-scales for smaller iPhones / iPads.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              {deviceOptions.map((d) => {
                const active = devices === d.value;
                const Icon = d.icon;
                return (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => setProject({ devices: d.value })}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      gap: 6,
                      padding: 14,
                      borderRadius: 'var(--r-3)',
                      border: `1px solid ${active ? 'var(--accent)' : 'var(--line-1)'}`,
                      background: active ? 'var(--accent-soft)' : 'var(--bg-2)',
                      cursor: 'pointer',
                      transition: 'all .12s',
                    }}
                  >
                    <Icon size={18} color={active ? 'var(--fg-0)' : 'var(--fg-1)'} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: active ? 'var(--fg-0)' : 'var(--fg-1)' }}>{d.label}</span>
                      <span style={{ fontSize: 11, color: 'var(--fg-2)' }}>{d.sub}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </Card.Section>

          <Card.Section title="Output folder">
            <Input
              placeholder="~/Developer/screenshots/SignPDF/"
              value={outputFolder}
              onChange={(e) => setProject({ outputFolder: e.target.value })}
              hint="PNGs will be written here. Leave blank to use ~/Developer/screenshots/{App}/"
            />
          </Card.Section>
        </Card>

        {/* A/B testing tools — each is its own surface in App Store Connect, so
            each gets its own entry section rather than a cramped button row. */}
        <ToolCard
          title="Product Page Optimization"
          gradient="linear-gradient(135deg, #14B8A6, #5EEAD4)"
          icon={<FlaskConical size={34} />}
          heading="Run multi-strategy screenshot A/B tests"
          description="Upload source screens once, generate N treatments via different AI prompts, and export each ready for an App Store Connect PPO experiment."
          countLabel={archivedPPOExperiments.length > 0 ? `${archivedPPOExperiments.length} saved session${archivedPPOExperiments.length === 1 ? '' : 's'}` : undefined}
          cta="Product Page Opt"
          onClick={() => nav('/ppo')}
        />
        <ToolCard
          title="Icon Generator"
          gradient="linear-gradient(135deg, #7C3AED, #A78BFA)"
          icon={<Shapes size={34} />}
          heading="Generate 1024 app-icon variants"
          description="Render square iOS icon variants from a base image + prompt. Icons ship inside the app binary as alternate icons, then get selected as PPO icon treatments."
          countLabel={iconVariantCount > 0 ? `${iconVariantCount} variant${iconVariantCount === 1 ? '' : 's'}` : undefined}
          cta="Icon Generator"
          onClick={() => nav('/icon-generator')}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8 }}>
          <Button variant="primary" size="lg" onClick={() => nav('/catalog')}>
            Continue → Style
          </Button>
        </div>

        {archivedProjects.length > 0 && (
          <section style={{ marginTop: 32 }}>
            <h2 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em' }}>
              Recent projects <span style={{ color: 'var(--fg-3)', fontSize: 12, fontWeight: 400 }}>· {archivedProjects.length}</span>
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
              {archivedProjects.map((p) => (
                <RecentCard key={p.id} project={p} onOpen={() => onOpenRecent(p.id)} onDelete={(e) => onDeleteRecent(e, p.id)} />
              ))}
            </div>
          </section>
        )}

        {archivedPPOExperiments.length > 0 && (
          <section style={{ marginTop: 32 }}>
            <h2 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em' }}>
              Recent PPO <span style={{ color: 'var(--fg-3)', fontSize: 12, fontWeight: 400 }}>· {archivedPPOExperiments.length}</span>
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
              {archivedPPOExperiments.map((p) => (
                <RecentPPOCard key={p.id} session={p} onOpen={() => onOpenPPO(p.id)} onDelete={(e) => onDeletePPO(e, p.id)} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

/** Entry section for an A/B-testing tool (PPO / Icon Generator). Mirrors the
 *  layout used on the PPO screen — gradient glyph tile + copy + CTA. */
function ToolCard({
  title,
  gradient,
  icon,
  heading,
  description,
  countLabel,
  cta,
  onClick,
}: {
  title: string;
  gradient: string;
  icon: ReactNode;
  heading: string;
  description: string;
  countLabel?: string;
  cta: string;
  onClick: () => void;
}) {
  return (
    <Card>
      <Card.Section title={title}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 18,
              flex: 'none',
              background: gradient,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              boxShadow: '0 8px 24px -8px rgba(0,0,0,0.4)',
            }}
          >
            {icon}
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg-0)', marginBottom: 4 }}>
              {heading}
            </div>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--fg-2)', lineHeight: 1.6 }}>
              {description}
              {countLabel && <> · <strong>{countLabel}</strong></>}
            </p>
          </div>
          <Button variant="primary" size="lg" rightIcon={<ArrowRight size={16} />} onClick={onClick}>
            {cta}
          </Button>
        </div>
      </Card.Section>
    </Card>
  );
}

function RecentCard({ project, onOpen, onDelete }: { project: ArchivedProject; onOpen: () => void; onDelete: (e: React.MouseEvent) => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 10,
        borderRadius: 'var(--r-3)',
        border: '1px solid var(--line-1)',
        background: 'var(--bg-1)',
        cursor: 'pointer',
        textAlign: 'left',
        font: 'inherit',
        color: 'inherit',
      }}
      title="Open in Editor"
    >
      <div
        style={{
          aspectRatio: '9 / 19.5',
          borderRadius: 8,
          background: project.thumbUrl ? '#000' : project.appColor,
          overflow: 'hidden',
          border: '1px solid var(--line-2)',
        }}
      >
        {project.thumbUrl && (
          <img
            src={project.thumbUrl}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {project.appName}
        </span>
        <span style={{ fontSize: 11, color: 'var(--fg-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {project.presetName} · {project.slotCount} slot{project.slotCount === 1 ? '' : 's'}
        </span>
        <span style={{ fontSize: 10, color: 'var(--fg-3)' }}>
          {new Date(project.archivedAt).toLocaleDateString()}
        </span>
      </div>
      <button
        type="button"
        onClick={onDelete}
        title="Delete"
        aria-label="Delete project"
        style={{
          position: 'absolute',
          top: 6,
          right: 6,
          width: 22,
          height: 22,
          border: 0,
          borderRadius: '50%',
          background: 'rgba(0,0,0,0.55)',
          color: '#fff',
          cursor: 'pointer',
          display: 'grid',
          placeItems: 'center',
        }}
      >
        <Trash2 size={11} />
      </button>
    </button>
  );
}

function RecentPPOCard({ session, onOpen, onDelete }: { session: ArchivedPPOExperiment; onOpen: () => void; onDelete: (e: React.MouseEvent) => void }) {
  // gpt-image-2 PNGs are huge — funnel through our proxy at w=400 for the
  // thumbnail so the Recent grid paints fast without browser-decoding 1290×2796
  // PNGs purely to scale them down.
  const apiBase = import.meta.env.BASE_URL === '/' ? '/api' : '/studio-api';
  const thumb = session.thumbUrl
    ? `${apiBase}/ppo/proxy-image?url=${encodeURIComponent(session.thumbUrl)}&w=400`
    : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 10,
        borderRadius: 'var(--r-3)',
        border: '1px solid var(--line-1)',
        background: 'var(--bg-1)',
        cursor: 'pointer',
        textAlign: 'left',
        font: 'inherit',
        color: 'inherit',
      }}
      title="Resume PPO session"
    >
      <div
        style={{
          aspectRatio: '9 / 19.5',
          borderRadius: 8,
          background: '#000',
          overflow: 'hidden',
          border: '1px solid var(--line-2)',
          display: 'grid',
          placeItems: 'center',
          color: 'var(--fg-3)',
          fontSize: 11,
        }}
      >
        {thumb ? (
          <img
            src={thumb}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <span>No renders yet</span>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {session.title}
        </span>
        <span style={{ fontSize: 11, color: 'var(--fg-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {session.strategyCount} strateg{session.strategyCount === 1 ? 'y' : 'ies'} · {session.renderedCount} rendered
        </span>
        <span style={{ fontSize: 10, color: 'var(--fg-3)' }}>
          {new Date(session.savedAt).toLocaleDateString()}
        </span>
      </div>
      <button
        type="button"
        onClick={onDelete}
        title="Delete"
        aria-label="Delete PPO session"
        style={{
          position: 'absolute',
          top: 6,
          right: 6,
          width: 22,
          height: 22,
          border: 0,
          borderRadius: '50%',
          background: 'rgba(0,0,0,0.55)',
          color: '#fff',
          cursor: 'pointer',
          display: 'grid',
          placeItems: 'center',
        }}
      >
        <Trash2 size={11} />
      </button>
    </button>
  );
}
