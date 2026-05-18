import { Link } from "@tanstack/react-router";
import { useResolveWikilink } from "@/hooks/use-resolve-wikilink";
import { useIsHoverDevice } from "@/hooks/use-is-hover-device";
import { useQuery } from "@tanstack/react-query";
import { resolveLegacyShortId } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface WikilinkChipProps {
  title: string;
  alias?: string;
}

/**
 * Renders a `[[Title]]` (or `[[Title|alias]]`) wikilink. Three states:
 *   - resolved → blue link, hover card shows snippet
 *   - unresolved (miss/collision) → purple unresolved link
 *   - loading → grey shimmer text
 *
 * Display text is the alias when present, falling back to the title.
 * Click navigates to /item/:id for resolved links; unresolved links
 * are a no-op `<span>` (no navigation target).
 */
export function WikilinkChip({ title, alias }: WikilinkChipProps) {
  const { data, isLoading } = useResolveWikilink(title);
  const display = alias ?? title;

  if (isLoading) {
    return (
      <span className="text-muted-foreground animate-pulse" data-testid="wikilink-loading">
        [[{display}]]
      </span>
    );
  }

  if (!data) {
    // Unresolved (miss or collision). Render purple per Obsidian convention.
    // No HoverCard — nothing to preview.
    return (
      <span
        className="text-purple-600 dark:text-purple-400 cursor-help"
        title="Unresolved wikilink"
        data-testid="wikilink-unresolved"
      >
        [[{display}]]
      </span>
    );
  }

  return <ResolvedWikilink data={data} display={display} />;
}

interface ResolvedWikilinkProps {
  data: { id: string; title: string; origin: string; snippet?: string };
  display: string;
}

/**
 * Renders the resolved link with a preview affordance. On hover-capable
 * devices (desktop) the preview is in a HoverCard that opens on pointer
 * hover. On touch devices the preview is in a Popover triggered by tap on
 * a peek button next to the link — taps on the link itself navigate (the
 * familiar mobile pattern: link = go, separate affordance = peek).
 */
function ResolvedWikilink({ data, display }: ResolvedWikilinkProps) {
  const isHover = useIsHoverDevice();

  const previewBody = (
    <div className="space-y-1">
      <div className="font-semibold text-sm">{data.title}</div>
      <div className="text-xs text-muted-foreground">
        {data.origin === "vault" ? "Vault" : "Sparkle"}
      </div>
      {data.snippet && <p className="text-sm text-muted-foreground line-clamp-4">{data.snippet}</p>}
    </div>
  );

  if (isHover) {
    return (
      <HoverCard openDelay={200} closeDelay={100}>
        <HoverCardTrigger asChild>
          <Link
            to="/item/$id"
            params={{ id: data.id }}
            className="text-primary underline decoration-dotted underline-offset-2 hover:no-underline"
            data-testid="wikilink-resolved"
            data-origin={data.origin}
          >
            {display}
          </Link>
        </HoverCardTrigger>
        <HoverCardContent className="w-80">{previewBody}</HoverCardContent>
      </HoverCard>
    );
  }

  // Touch device: link navigates on tap; small chevron button opens a
  // Popover preview. Keeps the primary action (navigate) on the link.
  return (
    <span className="inline-flex items-baseline gap-0.5" data-testid="wikilink-resolved-mobile">
      <Link
        to="/item/$id"
        params={{ id: data.id }}
        className="text-primary underline decoration-dotted underline-offset-2"
        data-testid="wikilink-resolved"
        data-origin={data.origin}
      >
        {display}
      </Link>
      <Popover>
        <PopoverTrigger
          aria-label={`預覽「${data.title}」`}
          className="text-xs text-muted-foreground px-1 py-0.5 rounded hover:bg-muted/50"
          data-testid="wikilink-mobile-peek"
        >
          ⓘ
        </PopoverTrigger>
        <PopoverContent className="w-80">{previewBody}</PopoverContent>
      </Popover>
    </span>
  );
}

interface LegacyRefChipProps {
  shortid: string;
}

/**
 * Mixed-state legacy `筆記（xxxx）` chip. Dashed border signals deprecated
 * syntax — encourages the user to convert to `[[Title]]`. Resolves the same
 * way as a wikilink (active priority) by looking up the short ID via the
 * resolver, but cosmetically distinct so the user notices the legacy origin.
 *
 * Falls back to plain text "筆記（xxxx）" when unresolved (legacy syntax
 * stays legible even when the target was deleted or never existed).
 */
export function LegacyRefChip({ shortid }: LegacyRefChipProps) {
  // Reuse the resolver endpoint by treating the short ID as a "title".
  // The server's resolver doesn't recognise hex prefixes, so this call
  // will 404 — instead use a dedicated lookup. PR 1 keeps it simple by
  // resolving via the existing item-detail endpoint short-prefix path.
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.wikilinks.resolve(`legacy:${shortid}`),
    queryFn: () => resolveLegacyShortId(shortid),
    staleTime: 5 * 60_000,
    retry: false,
  });

  if (isLoading) {
    return (
      <span className="text-muted-foreground animate-pulse" data-testid="legacy-ref-loading">
        筆記（{shortid}）
      </span>
    );
  }

  if (!data) {
    return (
      <span
        className={cn(
          "inline-flex items-center px-1.5 py-0.5 rounded border border-dashed",
          "border-amber-400 text-amber-700 dark:text-amber-300 text-xs",
        )}
        title="Legacy reference — target not found"
        data-testid="legacy-ref-unresolved"
      >
        筆記（{shortid}）
      </span>
    );
  }

  return (
    <Link
      to="/item/$id"
      params={{ id: data.id }}
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded border border-dashed",
        "border-amber-400 text-amber-700 dark:text-amber-300 text-xs",
        "hover:bg-amber-50 dark:hover:bg-amber-950/30",
      )}
      title="Legacy syntax — consider rewriting to [[wikilink]]"
      data-testid="legacy-ref-resolved"
    >
      {data.title}
    </Link>
  );
}

// React-markdown passes hProperties as DOM attributes. Lowercase to match
// the hName tag emitted by remark-wikilink.
type WikilinkElProps = { title: string; alias?: string };
type LegacyRefElProps = { shortid: string };

export const wikilinkMarkdownComponents = {
  "sparkle-wikilink": (props: WikilinkElProps) => (
    <WikilinkChip title={props.title} alias={props.alias} />
  ),
  "sparkle-legacy-ref": (props: LegacyRefElProps) => <LegacyRefChip shortid={props.shortid} />,
};
