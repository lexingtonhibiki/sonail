import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function ArtifactPreview({ files }: { files: { path: string; content?: string; note?: string }[] }) {
  return <div className="sb-artifacts">{!files.length ? <p>暂无可预览的交付文件 / No deliverable preview available</p> : files.map(file => <section key={file.path}><h4>{file.path}</h4>{file.content === undefined ? <p>{file.note}</p> : /\.md$/i.test(file.path) ? <><div className="sb-markdown"><Markdown remarkPlugins={[remarkGfm]} components={{ img: ({ alt }) => <span>[{alt || '图片 / Image'}]</span>, a: ({ children }) => <span>{children}</span> }}>{file.content}</Markdown></div><details><summary>查看原文 / Source</summary><pre>{file.content}</pre></details></> : <pre>{file.content}</pre>}</section>)}</div>;
}
