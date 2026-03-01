import { memo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// react-markdown v10 component overrides. We use explicit prop types to avoid
// implicit-any errors when type declarations aren't installed locally.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MdProps = { children?: ReactNode; className?: string; node?: unknown; [k: string]: any };

const components = {
  code({ className, children, node: _, ...rest }: MdProps) {
    const match = /language-(\w+)/.exec((className as string) || "");
    const isBlock = match || (typeof children === "string" && children.includes("\n"));
    if (isBlock) {
      return (
        <div className="my-2 rounded-xl border border-white/10 bg-neutral-950/70 overflow-x-auto shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          {match && (
            <div className="px-3 py-1 text-[10px] text-neutral-500 border-b border-white/8 font-mono uppercase tracking-[0.08em]">
              {match[1]}
            </div>
          )}
          <pre className="px-3 py-2 text-xs font-mono leading-relaxed text-neutral-200 overflow-x-auto">
            <code {...rest}>{children}</code>
          </pre>
        </div>
      );
    }
    return (
      <code
        className="px-1.5 py-0.5 rounded-md bg-neutral-800/90 text-primary-200 text-xs font-mono"
        {...rest}
      >
        {children}
      </code>
    );
  },
  pre({ children }: MdProps) {
    return <>{children}</>;
  },
  a({ href, children, node: _, ...rest }: MdProps & { href?: string }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary-300 hover:text-primary-200 underline decoration-primary-500/70 underline-offset-2"
        {...rest}
      >
        {children}
      </a>
    );
  },
  ul({ children, node: _, ...rest }: MdProps) {
    return (
      <ul className="list-disc list-inside my-1 space-y-0.5" {...rest}>
        {children}
      </ul>
    );
  },
  ol({ children, node: _, ...rest }: MdProps) {
    return (
      <ol className="list-decimal list-inside my-1 space-y-0.5" {...rest}>
        {children}
      </ol>
    );
  },
  table({ children, node: _, ...rest }: MdProps) {
    return (
      <div className="my-2 overflow-x-auto rounded-lg border border-white/10 bg-neutral-950/40">
        <table className="min-w-full text-xs" {...rest}>
          {children}
        </table>
      </div>
    );
  },
  thead({ children, node: _, ...rest }: MdProps) {
    return (
      <thead className="bg-neutral-900/60 text-neutral-400" {...rest}>
        {children}
      </thead>
    );
  },
  th({ children, node: _, ...rest }: MdProps) {
    return (
      <th className="px-3 py-1.5 text-left font-medium border-b border-neutral-800" {...rest}>
        {children}
      </th>
    );
  },
  td({ children, node: _, ...rest }: MdProps) {
    return (
      <td className="px-3 py-1.5 border-b border-neutral-800/50" {...rest}>
        {children}
      </td>
    );
  },
  blockquote({ children, node: _, ...rest }: MdProps) {
    return (
      <blockquote
        className="border-l-2 border-primary-400/40 pl-3 italic text-neutral-300/90 my-1"
        {...rest}
      >
        {children}
      </blockquote>
    );
  },
  strong({ children, node: _, ...rest }: MdProps) {
    return (
      <strong className="text-neutral-100 font-semibold" {...rest}>
        {children}
      </strong>
    );
  },
  em({ children, node: _, ...rest }: MdProps) {
    return (
      <em className="text-neutral-300" {...rest}>
        {children}
      </em>
    );
  },
  p({ children, node: _, ...rest }: MdProps) {
    return (
      <p className="my-1 first:mt-0 last:mb-0" {...rest}>
        {children}
      </p>
    );
  },
  h1({ children, node: _, ...rest }: MdProps) {
    return (
      <h1 className="text-base font-bold text-neutral-100 mt-3 mb-1" {...rest}>
        {children}
      </h1>
    );
  },
  h2({ children, node: _, ...rest }: MdProps) {
    return (
      <h2 className="text-sm font-bold text-neutral-100 mt-2 mb-1" {...rest}>
        {children}
      </h2>
    );
  },
  h3({ children, node: _, ...rest }: MdProps) {
    return (
      <h3 className="text-sm font-semibold text-neutral-200 mt-2 mb-0.5" {...rest}>
        {children}
      </h3>
    );
  },
  hr() {
    return <hr className="border-neutral-800 my-2" />;
  },
};

const remarkPlugins = [remarkGfm];

export const MarkdownContent = memo(function MarkdownContent({
  content,
  streaming,
}: {
  content: string;
  streaming?: boolean;
}) {
  return (
    <div className="text-[15px] sm:text-sm text-neutral-200 leading-7 sm:leading-relaxed break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
        {content}
      </ReactMarkdown>
      {streaming && (
        <span
          className="inline-block w-1.5 h-4 bg-primary-400 rounded-sm ml-0.5 animate-pulse"
          aria-hidden="true"
        />
      )}
    </div>
  );
});
