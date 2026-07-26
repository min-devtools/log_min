import type { RefObject } from "react";
import { motion } from "motion/react";
import { Icon } from "../../ui/Icon";
import { ToolButton } from "../../ui/ToolButton";

export interface LogSearchBarProps {
  inputRef: RefObject<HTMLInputElement>;
  query: string;
  onQueryChange: (q: string) => void;
  placeholder: string;
  invalid?: boolean;
  countText: string;
  /** live-filter toggle state; omit the handler to hide the button */
  filterMode?: boolean;
  onToggleFilter?: () => void;
  caseSensitive: boolean;
  onToggleCase: () => void;
  regexMode: boolean;
  onToggleRegex: () => void;
  navDisabled?: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}

/** the shared find bar under a log toolbar — caller wraps it in AnimatePresence */
export function LogSearchBar({
  inputRef,
  query,
  onQueryChange,
  placeholder,
  invalid,
  countText,
  filterMode,
  onToggleFilter,
  caseSensitive,
  onToggleCase,
  regexMode,
  onToggleRegex,
  navDisabled,
  onPrev,
  onNext,
  onClose,
}: LogSearchBarProps) {
  return (
    <motion.div
      className={`log-search ${invalid ? "invalid" : ""}`}
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.12, ease: [0.05, 0.7, 0.1, 1] }}
    >
      <Icon name="search" size={13} />
      <input
        ref={inputRef}
        value={query}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.shiftKey ? onPrev() : onNext());
          if (e.key === "Escape") onClose();
        }}
      />
      <span className="log-search-count" title={invalid ? "Invalid regular expression" : undefined}>
        {countText}
      </span>
      {onToggleFilter && (
        <ToolButton
          iconOnly
          title="Live filter — show only matching lines, including new output"
          aria-label="Live filter"
          aria-pressed={filterMode}
          className={`log-search-case ${filterMode ? "active" : ""}`}
          onClick={onToggleFilter}
        >
          <Icon name="filter" size={13} />
        </ToolButton>
      )}
      <ToolButton
        iconOnly
        title="Match case"
        aria-label="Match case"
        aria-pressed={caseSensitive}
        className={`log-search-case ${caseSensitive ? "active" : ""}`}
        onClick={onToggleCase}
      >
        Aa
      </ToolButton>
      <ToolButton
        iconOnly
        title="Regular expression"
        aria-label="Regular expression"
        aria-pressed={regexMode}
        className={`log-search-case ${regexMode ? "active" : ""}`}
        onClick={onToggleRegex}
      >
        .*
      </ToolButton>
      <ToolButton iconOnly disabled={navDisabled} title="Previous match (⇧↵)" aria-label="Previous match" onClick={onPrev}>
        <Icon name="arrow-left" />
      </ToolButton>
      <ToolButton iconOnly disabled={navDisabled} title="Next match (↵)" aria-label="Next match" onClick={onNext}>
        <Icon name="arrow-right" />
      </ToolButton>
      <ToolButton iconOnly title="Close (Esc)" aria-label="Close search" onClick={onClose}>
        <Icon name="x" />
      </ToolButton>
    </motion.div>
  );
}
