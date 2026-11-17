import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Seller-written Markdown. Raw HTML is never rendered (react-markdown escapes
 * it), images are not embedded, and links open safely without passing ranking.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-sm flex flex-col gap-3 text-sm leading-relaxed [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        disallowedElements={["img"]}
        components={{
          a: ({ href, children: label }) => (
            <a href={href} target="_blank" rel="nofollow ugc noopener noreferrer">
              {label}
            </a>
          ),
          h1: ({ children: text }) => <h3 className="text-base font-semibold">{text}</h3>,
          h2: ({ children: text }) => <h3 className="text-base font-semibold">{text}</h3>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
