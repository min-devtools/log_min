export interface MiniTab {
  id: string;
  label: string;
}

export function MiniTabs({
  tabs,
  active,
  onChange,
}: {
  tabs: MiniTab[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="mini-tabs">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          className={t.id === active ? "active" : ""}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
