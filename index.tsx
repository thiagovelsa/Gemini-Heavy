import React, { useState, useEffect, useRef, FormEvent, FC, ReactNode, ChangeEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Content, Part, Type } from '@google/genai';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const PRE_CHECK_SYSTEM_INSTRUCTION = "You are a helpful assistant that determines if a query needs a web search. Respond only with 'YES' or 'NO'.";
const INITIAL_SYSTEM_INSTRUCTION = "You are a Foundational Agent, the 'brainstormer' in a multi-agent team. Your primary role is to conduct a 'breadth-first' exploration of the user's query. Your goal is to generate a comprehensive initial draft that covers a wide spectrum of ideas, potential angles, and relevant information. Do not prioritize depth or perfection yet; focus on breadth and providing a rich, detailed foundation for other agents to build upon. Analyze the user's query, long-term memory, and any attached files. Your output is a strictly internal document and will NOT be shown to the user; it serves as raw material for the refinement stage.";
const REFINEMENT_SYSTEM_INSTRUCTION = "You are a Refinement Agent, a 'skeptical expert' and adversarial collaborator. Your goal is to elevate a first draft to a new level of quality. Given the user's query and an initial response, your task is to challenge every assumption, deepen the analysis, and enhance clarity. Identify logical fallacies, superficial points, and weak arguments. Your output is not a critique; it is a completely rewritten, superior version of the draft. Add nuance, provide concrete examples, and introduce counter-arguments where appropriate to create a more robust and insightful response.";
const SYNTHESIZER_SYSTEM_INSTRUCTION = "You are the Synthesizer Agent, the 'final editor and author'. Your mission is to produce the single, definitive response for the user. You will receive multiple, high-quality refined drafts. Your task is to cherry-pick the absolute best ideas, phrases, and structures from each, weaving them into a single, seamless, and perfectly coherent answer. Your final output must adopt a consistent and appropriate tone and be polished for presentation. Crucially, before concluding, you MUST perform a final verification step: meticulously compare your draft against the user's original query to guarantee that every single part of it has been fully and directly addressed. If you use the code interpreter tool, clearly state the code executed and its output in a structured way.";
const PROMPT_REFINER_SYSTEM_INSTRUCTION = "You are the Prompt Refiner. Transform a raw user prompt into a clearer, complete, and actionable prompt. Your entire output, including the refined prompt, questions, and rationale, must be in the exact same language as the original user's prompt. Do not translate. Output format: (1) REFINED PROMPT — a single, improved prompt that preserves the user’s goal, constraints, and formatting; (2) QUESTIONS (if needed) — 3–5 concise questions only if critical info is missing; (3) RATIONALE (1–2 sentences) — what you improved (structure, clarity, specificity), no meta talk. Checklist you must apply: clarify goal, audience, output format, constraints, success criteria; keep tone/language/formatting; remove fluff, ambiguity, duplicates; add acceptance criteria when useful; avoid binding to specific tech unless the input demands it; be concise and direct; prefer imperative verbs.";
const SUMMARIZER_SYSTEM_INSTRUCTION = "You are the Memory Agent. Your task is to extract the single most important, durable fact or preference about the user that will be useful for personalizing future conversations. Analyze the user's query and the final AI response. Condense the core insight into a single, concise, third-person statement (e.g., 'The user is a Python developer interested in data science libraries.'). Output only this sentence. IMPORTANT: Do not save transient or temporary information (e.g., 'The user asked for a recipe for cookies.'). Focus only on stable, long-term attributes.";
const SEARCH_REFINER_SYSTEM_INSTRUCTION = "You are a Search Query Refiner AI. Your task is to analyze the user's prompt and determine the best possible search query to find the most relevant information online. You must also generate clarifying questions to help the user narrow down their search if needed. Your output must be in the exact same language as the original user's prompt. Do not translate. Output format must be a JSON object with two keys: 'searchQuery' (a string with the optimal search query) and 'questions' (an array of 3-5 concise strings with clarifying questions).";
const CRITIC_SYSTEM_INSTRUCTION = "You are the Critic Agent. Your task is to perform a final quality assurance check on a proposed answer against the user's original query. Your evaluation must be strict. Review against these five criteria: 1) Factual Accuracy, 2) Completeness (all parts of the query answered?), 3) Clarity & Readability, 4) Relevance, and 5) Tone. If the answer is flawless across all criteria, respond ONLY with the word 'PERFECT'. Otherwise, provide a concise, constructive, and actionable critique outlining the specific flaws. Your feedback is for another agent to make corrections; do not rewrite the answer yourself.";
const PROACTIVE_ASSISTANT_SYSTEM_INSTRUCTION = "You are a Proactive Assistant AI. Your task is to analyze the user's query and the AI's final response to anticipate the user's next need. Generate 2-3 concise, relevant, and helpful follow-up suggestions as clickable prompts for the user. Frame them as questions or commands. For example: 'Write unit tests for this code.' or 'Can you suggest some restaurants for this trip?'. Your output must be a JSON array of strings. For example: `[\"Suggestion 1\", \"Suggestion 2\"]`. Do not add any other text or explanation. Only return the JSON array.";

interface GenerationDetails {
  initial: string[];
  refined: string[];
}

interface ToolOutput {
  code: string;
  result: Part[];
}

interface Message {
  role: 'user' | 'model';
  parts: Part[];
  sources?: { uri: string; title: string }[];
  attachedFiles?: File[];
  isError?: boolean;
  generationDetails?: GenerationDetails;
  toolOutputs?: ToolOutput[];
}


interface Conversation {
    id: string;
    title: string;
    messages: Message[];
}

interface AttachedFile {
  file: File;
  content: Part;
  previewUrl?: string;
}

interface RefineData {
    original: string;
    refined: string;
    questions?: string[];
    rationale: string;
}

interface SearchConfirmationData {
    originalUserInput: string;
    searchQuery: string;
    questions: string[];
    attachedFileParts: Part[];
    history: Content[];
}

const useAutoResizeTextarea = (textareaRef: React.RefObject<HTMLTextAreaElement>, value: string) => {
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      const scrollHeight = textarea.scrollHeight;
      textarea.style.height = `${scrollHeight}px`;
    }
  }, [textareaRef, value]);
};

const CodeBlock: FC<{ children?: ReactNode }> = ({ children }) => {
  const [copyStatus, setCopyStatus] = useState('Copiar');
  const [isWrapped, setIsWrapped] = useState(true);

  const codeString = React.Children.map(children, child => {
      if (React.isValidElement<{ children?: React.ReactNode }>(child) && child.props.children) {
          return child.props.children;
      }
      return child;
  })?.join('')?.replace(/\n$/, '') || '';

  const handleCopy = async () => {
      try {
          await navigator.clipboard.writeText(codeString);
          setCopyStatus('Copiado!');
          setTimeout(() => setCopyStatus('Copiar'), 2000);
      } catch (err) {
          setCopyStatus('Falhou!');
          setTimeout(() => setCopyStatus('Copiar'), 2000);
      }
  };

  return (
      <div className="code-block-wrapper">
          <div className="code-block-header">
              <div className="code-block-actions">
                  <button className="code-action-button" onClick={() => setIsWrapped(!isWrapped)} title={isWrapped ? "Não quebrar linhas" : "Quebrar linhas"}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          {isWrapped ? (
                              <>
                                  <path d="M17 6.5L21.5 11" /><path d="M17 11.5L21.5 7" /><path d="M21 17H3" /><path d="M21 12H3" /><path d="M21 7H3" />
                              </>
                          ) : (
                              <>
                                  <path d="M17 6.5L21.5 11" /><path d="M21.5 11L17 15.5" /><path d="M21 11H3" />
                              </>
                          )}
                      </svg>
                      <span>{isWrapped ? 'Com quebra' : 'Sem quebra'}</span>
                  </button>
                  <button className="code-action-button" onClick={handleCopy}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                          <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                      </svg>
                      <span>{copyStatus}</span>
                  </button>
              </div>
          </div>
          <pre style={{ whiteSpace: isWrapped ? 'pre-wrap' : 'pre' }}><code>{children}</code></pre>
      </div>
  );
};

const MessageCopyButton: FC<{ text: string }> = ({ text }) => {
    const [copyStatus, setCopyStatus] = useState<ReactNode>('Copiar');

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(text);
            setCopyStatus(<span className="copy-tooltip-text">Copiado!</span>);
            setTimeout(() => setCopyStatus('Copiar'), 2000);
        } catch (err) {
            setCopyStatus(<span className="copy-tooltip-text">Falhou!</span>);
            setTimeout(() => setCopyStatus('Copiar'), 2000);
        }
    };

    return (
        <button className="message-action-button" onClick={handleCopy} aria-label="Copiar mensagem">
            {copyStatus === 'Copiar' ? (
                 <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" />
                </svg>
            ) : (
                copyStatus
            )}
        </button>
    );
};

const SourcesDisplay: FC<{ sources: { uri: string; title: string }[] }> = ({ sources }) => {
    if (!sources || sources.length === 0) return null;
    return (
        <div className="sources-container">
            <h3 className="sources-title">Fontes</h3>
            <div className="sources-list">
                {sources.map((source, index) => (
                    <a key={index} href={source.uri} target="_blank" rel="noopener noreferrer" className="source-link">
                         <div className="source-favicon">
                            <img src={`https://www.google.com/s2/favicons?domain=${new URL(source.uri).hostname}&sz=32`} alt="favicon"/>
                        </div>
                        <span className="source-title">{source.title}</span>
                    </a>
                ))}
            </div>
        </div>
    );
};

// --- Lucide Icon Components ---
const IconSearch = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>;
const IconBot = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>;
const IconSparkles = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.93 2.25 12 7.33l2.07-5.08"/><path d="M5.22 5.22 8.5 8.5"/><path d="M2.25 9.93 7.33 12l-5.08 2.07"/><path d="M5.22 18.78 8.5 15.5"/><path d="M9.93 21.75 12 16.67l2.07 5.08"/><path d="M18.78 18.78 15.5 15.5"/><path d="M21.75 14.07 16.67 12l5.08-2.07"/><path d="M18.78 5.22 15.5 8.5"/></svg>;
const IconBlend = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="9" r="7"/><circle cx="15" cy="15" r="7"/></svg>;
const IconLoader: FC<React.SVGProps<SVGSVGElement>> = (props) => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M12 2v4"/><path d="M12 18v4"/><path d="m4.93 4.93 2.83 2.83"/><path d="m16.24 16.24 2.83 2.83"/><path d="M2 12h4"/><path d="M18 12h4"/><path d="m4.93 19.07 2.83-2.83"/><path d="m16.24 7.76 2.83-2.83"/></svg>;
const IconCheck = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>;
const IconFileText = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>;
const IconImage = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>;
const IconCode2 = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 22h14a2 2 0 0 0 2-2V7.5L14.5 2H6a2 2 0 0 0-2 2v4"/><path d="M14 2v6h6"/><path d="m10 13-2 2 2 2"/><path d="m14 17 2-2-2-2"/></svg>;
const IconFile = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>;
const IconAlertTriangle = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>;
const IconPlus = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>;
const IconMessageSquare = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>;
const IconHistory = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>;
const IconZap = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>;
const IconBalance = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m16 16 3-8 3 8c-2 2-4 2-6 0"/><path d="m2 16 3-8 3 8c-2 2-4 2-6 0"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/></svg>;
const IconBrainCircuit = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a10 10 0 0 0-3.54 19.46"/><path d="M12 2a10 10 0 0 1 3.54 19.46"/><path d="M4 13a4 4 0 1 0 0-2 4 4 0 0 0 0 2z"/><path d="M12 13a4 4 0 1 0 0-2 4 4 0 0 0 0 2z"/><path d="M20 13a4 4 0 1 0 0-2 4 4 0 0 0 0 2z"/><path d="M4.5 9.5h-.01"/><path d="M12.5 9.5h-.01"/><path d="M19.5 9.5h-.01"/><path d="M4.5 14.5h-.01"/><path d="M12.5 14.5h-.01"/><path d="M19.5 14.5h-.01"/><path d="M15 4.5V5"/><path d="M9 4.5V5"/><path d="m6.7 6.7-.01.01"/><path d="m17.3 6.7-.01.01"/><path d="m6.7 17.3.01-.01"/><path d="m17.3 17.3.01-.01"/></svg>;
const IconTrash = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>;
const IconShieldCheck = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>;
const IconWand = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 4V2"/><path d="M15 10V8"/><path d="M11.5 7.5h-3"/><path d="M20 15V8a2 2 0 0 0-2-2h-5"/><path d="M9 11.5v3"/><path d="M5.5 15h3"/><path d="M4 22l4-4"/><path d="m15 15 4 4"/><path d="M9 22l4-4"/><path d="M5 15l-1.5 1.5A2.82 2.82 0 0 0 5 22"/></svg>;
const IconLayers = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>;
const IconTerminalSquare = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m7 11 2-2-2-2"/><path d="M11 13h4"/><rect width="18" height="18" x="3" y="3" rx="2"/></svg>;
const IconEdit = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>;


const getFileTypeIcon = (mimeType: string): ReactNode => {
    if (mimeType.startsWith('image/')) return <IconImage />;
    if (mimeType.startsWith('text/')) return <IconFileText />;
    if (['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(mimeType)) return <IconFileText />;
    if (['application/javascript', 'application/json', 'text/css', 'text/html', 'text/x-python', 'application/x-sh'].includes(mimeType)) return <IconCode2 />;
    return <IconFile />;
};

type TaskStatus = 'pending' | 'active' | 'completed';
type ResearchMode = 'offline' | 'web' | 'deep';
type ModelName = 'gemini-2.5-pro' | 'gemini-2.5-flash';
type GenerationDepth = 'fast' | 'balanced' | 'deep';

interface LoadingTask {
  name: string;
  status: TaskStatus;
  icon: ReactNode;
}

const HISTORY_PROCESSING_TASK: LoadingTask = { name: "Processando histórico...", icon: <IconHistory />, status: 'pending' };
const BRAINSTORMING_TASK: LoadingTask = { name: "Brainstorming...", icon: <IconBot />, status: 'pending' };
const REFINING_TASK: LoadingTask = { name: "Refinando rascunhos...", icon: <IconSparkles />, status: 'pending' };
const SYNTHESIZING_TASK: LoadingTask = { name: "Sintetizando resposta...", icon: <IconBlend />, status: 'pending' };
const CRITIC_TASK: LoadingTask = { name: "Revisão crítica...", icon: <IconShieldCheck />, status: 'pending' };
const SEARCHING_TASK: LoadingTask = { name: "Pesquisando na web...", icon: <IconSearch />, status: 'pending' };


const OFFLINE_TASKS: LoadingTask[] = [
    HISTORY_PROCESSING_TASK,
    BRAINSTORMING_TASK,
    REFINING_TASK,
    SYNTHESIZING_TASK,
    CRITIC_TASK,
];
const WEB_RESEARCH_TASKS: LoadingTask[] = [
    HISTORY_PROCESSING_TASK,
    SEARCHING_TASK,
    BRAINSTORMING_TASK,
    REFINING_TASK,
    SYNTHESIZING_TASK,
    CRITIC_TASK,
];
const DEEP_RESEARCH_TASKS: LoadingTask[] = [
    HISTORY_PROCESSING_TASK,
    SEARCHING_TASK,
    BRAINSTORMING_TASK,
    REFINING_TASK,
    SYNTHESIZING_TASK,
    CRITIC_TASK,
];

const formatTimer = (milliseconds: number): string => {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
};

const LoadingIndicator: FC<{ tasks: LoadingTask[], timer: number, activeTaskName?: string }> = ({ tasks, timer, activeTaskName }) => {
    const completedCount = tasks.filter(t => t.status === 'completed').length;
    const progressPercentage = tasks.length > 0 ? (completedCount / (tasks.length - 1)) * 100 : 0;

    return (
        <div className="message-wrapper model-wrapper">
             <div className="avatar model-avatar">
                <IconBot />
            </div>
            <div className="message-content-wrapper">
                <div className="message model loading-animation">
                    <div className="loading-header">
                        <div className="loading-status-container">
                            <div className="loading-status">Gerando resposta...</div>
                            {activeTaskName && <div className="loading-sub-status">{activeTaskName}</div>}
                        </div>
                        <div className="timer-display">{formatTimer(timer)}</div>
                    </div>
                    <div className="loading-task-list-wrapper">
                        <div className="loading-progress-bar-container">
                            <div className="loading-progress-bar" style={{ height: `${progressPercentage}%` }}></div>
                        </div>
                        <div className="loading-task-list">
                            {tasks.map((task, index) => (
                                <div
                                    key={index}
                                    className={`loading-task-item ${task.status}`}
                                    style={{ animationDelay: `${index * 100}ms` }}
                                >
                                    <div className="task-status-icon">
                                        {task.status === 'pending' && <div className="task-icon">{task.icon}</div>}
                                        {task.status === 'active' && <div className="task-icon processing-icon"><IconLoader /></div>}
                                        {task.status === 'completed' && <div className="task-icon completed-icon"><IconCheck /></div>}
                                    </div>
                                    <span className="task-name">{task.name}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const RefinePanel: FC<{
    data: RefineData | null;
    isRefining: boolean;
    error: string | null;
    onApply: (text: string) => void;
    onClose: () => void;
}> = ({ data, isRefining, error, onApply, onClose }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editedText, setEditedText] = useState("");
    const [copyStatus, setCopyStatus] = useState("Copiar");
    const editRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (data && !isEditing) {
            setEditedText(data.refined);
        }
    }, [data, isEditing]);

    useEffect(() => {
        if (isEditing && editRef.current) {
            if (document.activeElement !== editRef.current) {
                editRef.current.focus();
            }
            editRef.current.style.height = 'auto';
            editRef.current.style.height = `${editRef.current.scrollHeight}px`;
        }
    }, [isEditing, editedText]);

    const handleCopy = async () => {
        if (!data) return;
        try {
            await navigator.clipboard.writeText(isEditing ? editedText : data.refined);
            setCopyStatus('Copiado!');
            setTimeout(() => setCopyStatus('Copiar'), 2000);
        } catch (err) {
            setCopyStatus('Falhou!');
            setTimeout(() => setCopyStatus('Copiar'), 2000);
        }
    };

    const handleApply = () => {
        if (!data) return;
        onApply(isEditing ? editedText : data.refined);
    };

    return (
        <div className="refine-panel">
            <div className="refine-panel-header">
                <h3>Refinar Pergunta</h3>
                <button type="button" className="settings-close-button" onClick={onClose} aria-label="Fechar painel de refinar">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                </button>
            </div>
            <div className="refine-panel-content">
                {isRefining && <div className="refine-state-message"><IconLoader className="processing-icon"/> Refinando sua pergunta...</div>}
                {error && <div className="refine-state-message error">{error}</div>}
                {data && (
                    <>
                        <div className="refine-columns">
                            <div className="refine-column">
                               <h4>Original</h4>
                                <pre>{data.original}</pre>
                            </div>
                            <div className="refine-column">
                                <h4>Refinada</h4>
                                {isEditing ? (
                                    <textarea 
                                        ref={editRef}
                                        value={editedText} 
                                        onChange={(e) => setEditedText(e.target.value)}
                                        className="refine-edit-textarea"
                                    />
                                ) : (
                                    <pre>{data.refined}</pre>
                                )}
                            </div>
                        </div>
                        <div className="refine-rationale">
                            <h5>Nota do Refinador</h5>
                            <p>{data.rationale}</p>
                        </div>
                        {data.questions && data.questions.length > 0 && (
                            <div className="refine-questions">
                                <h5>Perguntas para Esclarecer</h5>
                                <ul>
                                    {data.questions.map((q, i) => <li key={i}>{q}</li>)}
                                </ul>
                            </div>
                        )}
                        <div className="refine-actions">
                            <button className="refine-action-button primary" onClick={handleApply}>Aplicar</button>
                            <button className="refine-action-button" onClick={() => setIsEditing(!isEditing)}>{isEditing ? "Cancelar" : "Editar"}</button>
                            <button className="refine-action-button" onClick={handleCopy}>{copyStatus}</button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

const Notification: FC<{
    message: string;
    type: 'success' | 'error';
    onDismiss: () => void;
}> = ({ message, type, onDismiss }) => {
    useEffect(() => {
        const timer = setTimeout(() => {
            onDismiss();
        }, 5000);
        return () => clearTimeout(timer);
    }, [onDismiss]);

    const Icon = type === 'success' ? IconCheck : IconAlertTriangle;

    return (
        <div className={`notification notification--${type}`}>
            <Icon />
            <span>{message}</span>
            <button onClick={onDismiss} className="notification-dismiss" aria-label="Dispensar">
               <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
        </div>
    );
};

const MemoryManagementModal: FC<{
    isOpen: boolean;
    onClose: () => void;
    memories: string[];
    onDelete: (index: number) => void;
    onClearAll: () => void;
    onAdd: (memory: string) => void;
}> = ({ isOpen, onClose, memories, onDelete, onClearAll, onAdd }) => {
    const [newMemory, setNewMemory] = useState('');

    if (!isOpen) return null;

    const handleAdd = (e: FormEvent) => {
        e.preventDefault();
        if (newMemory.trim()) {
            onAdd(newMemory.trim());
            setNewMemory('');
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>Gerenciar Memória</h3>
                    <button type="button" className="settings-close-button" onClick={onClose} aria-label="Fechar">
                         <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                    </button>
                </div>
                <div className="modal-body">
                     <form onSubmit={handleAdd} className="add-memory-form">
                        <textarea
                            value={newMemory}
                            onChange={(e) => setNewMemory(e.target.value)}
                            placeholder="Adicionar nova memória para o agente..."
                            className="add-memory-input"
                            aria-label="Nova memória"
                            rows={2}
                        />
                        <button type="submit" className="add-memory-button" disabled={!newMemory.trim()}>
                            <IconPlus /> Adicionar
                        </button>
                    </form>
                    {memories.length === 0 ? (
                        <p className="empty-memories-message">Nenhuma memória armazenada ainda.</p>
                    ) : (
                        <ul className="memory-list">
                            {memories.map((memory, index) => (
                                <li key={index} className="memory-item">
                                    <span>{memory}</span>
                                    <button onClick={() => onDelete(index)} className="delete-memory-button" aria-label="Deletar memória">
                                        <IconTrash />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
                <div className="modal-footer">
                    <button 
                        className="clear-all-memories-button" 
                        onClick={onClearAll}
                        disabled={memories.length === 0}
                    >
                        Limpar Toda a Memória
                    </button>
                </div>
            </div>
        </div>
    );
};

const ProactiveSuggestions: FC<{
    suggestions: string[];
    onSelect: (suggestion: string) => void;
}> = ({ suggestions, onSelect }) => {
    if (suggestions.length === 0) return null;
    return (
        <div className="proactive-suggestions-container">
            {suggestions.map((suggestion, index) => (
                <button key={index} className="proactive-suggestion-button" onClick={() => onSelect(suggestion)}>
                    <IconWand />
                    <span>{suggestion}</span>
                </button>
            ))}
        </div>
    );
};

const AttachmentDisplay: FC<{ files: File[] }> = ({ files }) => {
    const [previews, setPreviews] = useState<{[key: string]: string}>({});

    useEffect(() => {
        const newPreviews: {[key: string]: string} = {};
        let isMounted = true;

        files.forEach(file => {
            if (file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onloadend = () => {
                    if (isMounted) {
                        newPreviews[file.name] = reader.result as string;
                        setPreviews(p => ({...p, ...newPreviews}));
                    }
                };
                reader.readAsDataURL(file);
            }
        });
        
        return () => { isMounted = false; };
    }, [files]);

    return (
        <div className="attachment-display-grid">
            {files.map((file, i) => (
                <div key={i} className="attachment-display-item">
                    {previews[file.name] ? (
                        <img src={previews[file.name]} alt={file.name} className="attachment-image-preview" />
                    ) : (
                        <div className="attachment-file-icon">{getFileTypeIcon(file.type)}</div>
                    )}
                    <div className="attachment-file-info">
                        <span className="attachment-filename">{file.name}</span>
                        <span className="attachment-filesize">{formatFileSize(file.size)}</span>
                    </div>
                </div>
            ))}
        </div>
    );
};

const CodeExecutionBlock: FC<{ output: ToolOutput }> = ({ output }) => {
    const [isCodeVisible, setIsCodeVisible] = useState(false);

    const renderOutput = (part: Part) => {
        if ('text' in part) {
            return <pre className="code-exec-output-text">{part.text}</pre>;
        }
        if ('inlineData' in part && part.inlineData.mimeType.startsWith('image/')) {
            const imageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
            return <img src={imageUrl} alt="Resultado do código" className="code-exec-output-image" />;
        }
        return <pre className="code-exec-output-text">Formato de saída não suportado.</pre>;
    };

    return (
        <div className="code-exec-block">
            <div className="code-exec-header">
                <IconTerminalSquare />
                <span>Interpretador de Código Python</span>
                <button onClick={() => setIsCodeVisible(!isCodeVisible)}>
                    {isCodeVisible ? 'Ocultar código' : 'Mostrar código'}
                </button>
            </div>
            {isCodeVisible && (
                 <div className="code-exec-input">
                    <CodeBlock>{output.code}</CodeBlock>
                 </div>
            )}
            <div className="code-exec-output">
                <div className="code-exec-output-header">Saída</div>
                {output.result.map((part, index) => <div key={index}>{renderOutput(part)}</div>)}
            </div>
        </div>
    );
};

const GenerationInspectorModal: FC<{
    isOpen: boolean;
    onClose: () => void;
    details: GenerationDetails | null;
}> = ({ isOpen, onClose, details }) => {
    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content inspector-modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>Processo de Geração</h3>
                    <button type="button" className="settings-close-button" onClick={onClose} aria-label="Fechar">
                         <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                    </button>
                </div>
                <div className="modal-body inspector-modal-body">
                    {details ? (
                        <>
                            <div className="inspector-section">
                                <h4 className="inspector-section-title">Respostas Iniciais</h4>
                                <div className="inspector-card-grid">
                                    {details.initial.map((text, i) => (
                                        <div key={i} className="inspector-agent-card">
                                            <div className="inspector-agent-header">Agente Inicial {i+1}</div>
                                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
                                        </div>
                                    ))}
                                </div>
                            </div>
                             <div className="inspector-section">
                                <h4 className="inspector-section-title">Respostas Refinadas</h4>
                                 <div className="inspector-card-grid">
                                    {details.refined.map((text, i) => (
                                        <div key={i} className="inspector-agent-card">
                                            <div className="inspector-agent-header">Agente Refinador {i+1}</div>
                                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </>
                    ) : (
                        <p>Nenhum detalhe de geração disponível.</p>
                    )}
                </div>
            </div>
        </div>
    );
};

const SearchConfirmationModal: FC<{
    isOpen: boolean;
    onConfirm: (editedQuery: string) => void;
    onCancel: () => void;
    data: { searchQuery: string; questions: string[] } | null;
}> = ({ isOpen, onConfirm, onCancel, data }) => {
    const [editedQuery, setEditedQuery] = useState('');

    useEffect(() => {
        if (data) {
            setEditedQuery(data.searchQuery);
        }
    }, [data]);

    if (!isOpen || !data) return null;

    const handleConfirm = () => {
        if (editedQuery.trim()) {
            onConfirm(editedQuery.trim());
        }
    };

    return (
        <div className="modal-overlay" onClick={onCancel}>
            <div className="modal-content search-confirm-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>Confirmar Pesquisa na Web</h3>
                    <button type="button" className="settings-close-button" onClick={onCancel} aria-label="Fechar">
                         <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                    </button>
                </div>
                <div className="modal-body">
                    <div className="search-confirm-section">
                        <label htmlFor="search-query-input">Consulta de pesquisa sugerida</label>
                        <p>O agente sugere esta consulta para pesquisar na web. Você pode editá-la antes de continuar.</p>
                        <input
                            id="search-query-input"
                            type="text"
                            value={editedQuery}
                            onChange={(e) => setEditedQuery(e.target.value)}
                            className="search-query-input"
                        />
                    </div>
                    {data.questions && data.questions.length > 0 && (
                         <div className="search-confirm-section">
                            <label>Perguntas para refinar</label>
                            <p>Considere estas perguntas para obter resultados melhores. Você pode cancelar e refinar sua pergunta original.</p>
                            <ul className="clarifying-questions-list">
                                {data.questions.map((q, i) => <li key={i}>{q}</li>)}
                            </ul>
                        </div>
                    )}
                </div>
                <div className="modal-footer">
                    <button className="search-confirm-button cancel" onClick={onCancel}>
                        Cancelar
                    </button>
                    <button className="search-confirm-button confirm" onClick={handleConfirm} disabled={!editedQuery.trim()}>
                        <IconSearch /> Pesquisar com esta consulta
                    </button>
                </div>
            </div>
        </div>
    );
};

interface CollapsibleSectionProps {
    title: string;
    children: ReactNode;
    isOpen: boolean;
    onToggle: () => void;
}

const CollapsibleSection: FC<CollapsibleSectionProps> = ({ title, children, isOpen, onToggle }) => {
    return (
        <div className={`settings-section ${isOpen ? 'open' : ''}`}>
            <button className="settings-section-header" onClick={onToggle} aria-expanded={isOpen}>
                <span>{title}</span>
                <svg className="chevron-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </button>
            <div className="settings-section-content">
                <div className="settings-section-content-inner">
                    {children}
                </div>
            </div>
        </div>
    );
};

const App: FC = () => {
    const [ai, setAi] = useState<GoogleGenAI | null>(null);
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
    const [input, setInput] = useState<string>('');
    const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [loadingTasks, setLoadingTasks] = useState<LoadingTask[]>([]);
    const [timer, setTimer] = useState<number>(0);
    const [showSettings, setShowSettings] = useState<boolean>(false);
    const [isInputAreaDragging, setIsInputAreaDragging] = useState<boolean>(false);
    const [isWindowDragging, setIsWindowDragging] = useState<boolean>(false);
    const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const [initialTemps, setInitialTemps] = useState<number[]>([0.9, 0.9, 0.9, 0.9]);
    const [refinementTemp, setRefinementTemp] = useState<number>(0.9);
    const [synthesizerTemp, setSynthesizerTemp] = useState<number>(0.9);
    const [researchMode, setResearchMode] = useState<ResearchMode>('offline');
    const [modelName, setModelName] = useState<ModelName>('gemini-2.5-pro');
    const [generationDepth, setGenerationDepth] = useState<GenerationDepth>('deep');
    const [isSelfCorrectionEnabled, setIsSelfCorrectionEnabled] = useState<boolean>(true);

    const [isRefinePanelOpen, setIsRefinePanelOpen] = useState(false);
    const [refineData, setRefineData] = useState<RefineData | null>(null);
    const [isRefining, setIsRefining] = useState(false);
    const [refineError, setRefineError] = useState<string | null>(null);

    const [isLongTermMemoryEnabled, setIsLongTermMemoryEnabled] = useState<boolean>(true);
    const [longTermMemories, setLongTermMemories] = useState<string[]>([]);
    const [showMemoryModal, setShowMemoryModal] = useState<boolean>(false);
    
    const [proactiveSuggestions, setProactiveSuggestions] = useState<string[]>([]);

    const [isCodeInterpreterEnabled, setIsCodeInterpreterEnabled] = useState<boolean>(true);
    const [isInspectorModalOpen, setIsInspectorModalOpen] = useState<boolean>(false);
    const [selectedMessageDetails, setSelectedMessageDetails] = useState<GenerationDetails | null>(null);

    const [showSearchConfirmation, setShowSearchConfirmation] = useState<boolean>(false);
    const [searchConfirmationData, setSearchConfirmationData] = useState<SearchConfirmationData | null>(null);

    const [editingConversationId, setEditingConversationId] = useState<string | null>(null);
    const [editingTitle, setEditingTitle] = useState<string>('');
    
    const [openSettingsSections, setOpenSettingsSections] = useState({
        model: true,
        agents: false,
        tools: false,
        memory: false,
    });

    const toggleSection = (section: keyof typeof openSettingsSections) => {
        setOpenSettingsSections(prev => ({
            ...prev,
            [section]: !prev[section],
        }));
    };

    const messageListRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useAutoResizeTextarea(textareaRef, input);
    
    useEffect(() => {
        try {
            const genAI = new GoogleGenAI({ apiKey: process.env.API_KEY });
            setAi(genAI);
        } catch (error) {
            console.error("Failed to initialize GoogleGenAI:", error);
        }
        
        try {
            const savedConversations = localStorage.getItem('gemini-heavy-conversations');
            if (savedConversations) {
                const parsed = JSON.parse(savedConversations);
                setConversations(parsed);
                const lastConversationId = localStorage.getItem('gemini-heavy-last-conversation');
                if (lastConversationId && parsed.find((c: Conversation) => c.id === lastConversationId)) {
                    setCurrentConversationId(lastConversationId);
                } else if (parsed.length > 0) {
                    setCurrentConversationId(parsed[0].id);
                } else {
                    handleNewChat();
                }
            } else {
                handleNewChat();
            }

            const savedMemories = localStorage.getItem('gemini-heavy-ltm');
            if (savedMemories) setLongTermMemories(JSON.parse(savedMemories));
            
            const memorySetting = localStorage.getItem('gemini-heavy-ltm-enabled');
            if(memorySetting) setIsLongTermMemoryEnabled(JSON.parse(memorySetting));
            
            const correctionSetting = localStorage.getItem('gemini-heavy-correction-enabled');
            if(correctionSetting) setIsSelfCorrectionEnabled(JSON.parse(correctionSetting));

            const codeInterpreterSetting = localStorage.getItem('gemini-heavy-code-interpreter-enabled');
            if(codeInterpreterSetting) setIsCodeInterpreterEnabled(JSON.parse(codeInterpreterSetting));

        } catch (error) {
            console.error("Failed to load data from localStorage", error);
            handleNewChat();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    
    useEffect(() => {
        if (conversations.length > 0) {
            localStorage.setItem('gemini-heavy-conversations', JSON.stringify(conversations));
        }
        if (currentConversationId) {
            localStorage.setItem('gemini-heavy-last-conversation', currentConversationId);
        }
    }, [conversations, currentConversationId]);

    useEffect(() => { localStorage.setItem('gemini-heavy-ltm', JSON.stringify(longTermMemories)); }, [longTermMemories]);
    useEffect(() => { localStorage.setItem('gemini-heavy-ltm-enabled', JSON.stringify(isLongTermMemoryEnabled)); }, [isLongTermMemoryEnabled]);
    useEffect(() => { localStorage.setItem('gemini-heavy-correction-enabled', JSON.stringify(isSelfCorrectionEnabled)); }, [isSelfCorrectionEnabled]);
    useEffect(() => { localStorage.setItem('gemini-heavy-code-interpreter-enabled', JSON.stringify(isCodeInterpreterEnabled)); }, [isCodeInterpreterEnabled]);

    // Auto-save input draft
    useEffect(() => {
        if (!currentConversationId || isLoading) return;
        const handler = setTimeout(() => {
            localStorage.setItem(`draft-input-${currentConversationId}`, input);
        }, 500);
        return () => clearTimeout(handler);
    }, [input, currentConversationId, isLoading]);

    // Load draft when switching conversations
    useEffect(() => {
        if (!currentConversationId) return;
        const savedDraft = localStorage.getItem(`draft-input-${currentConversationId}`);
        if (savedDraft) {
            setInput(savedDraft);
        } else {
            setInput('');
        }
    }, [currentConversationId]);


    useEffect(() => {
        if (messageListRef.current) {
            messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
        }
    }, [conversations, currentConversationId, isLoading, proactiveSuggestions]);

    useEffect(() => {
        if (isLoading) {
            timerRef.current = setInterval(() => {
                setTimer(prevTimer => prevTimer + 100);
            }, 100);
        } else if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [isLoading]);

    useEffect(() => {
        const handleWindowDragEnter = (e: DragEvent) => {
            e.preventDefault();
            if(e.dataTransfer?.types.includes('Files')) {
                setIsWindowDragging(true);
            }
        };
        const handleWindowDragLeave = (e: DragEvent) => {
            if (e.relatedTarget === null || e.relatedTarget === undefined) {
                 setIsWindowDragging(false);
            }
        };
        const handleWindowDrop = (e: DragEvent) => {
            e.preventDefault();
            setIsWindowDragging(false);
        };
        const handleWindowDragOver = (e: DragEvent) => {
             e.preventDefault();
        };

        window.addEventListener('dragenter', handleWindowDragEnter);
        window.addEventListener('dragleave', handleWindowDragLeave);
        window.addEventListener('drop', handleWindowDrop);
        window.addEventListener('dragover', handleWindowDragOver);

        return () => {
            window.removeEventListener('dragenter', handleWindowDragEnter);
            window.removeEventListener('dragleave', handleWindowDragLeave);
            window.removeEventListener('drop', handleWindowDrop);
            window.removeEventListener('dragover', handleWindowDragOver);
        };
    }, []);

    const fileToGenerativePart = async (file: File): Promise<{ content: Part, previewUrl?: string }> => {
        const base64EncodedData = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve((reader.result as string)); // Keep the full data URL
            reader.onerror = (error) => reject(new Error(`Failed to read file: ${file.name}. Reason: ${error}`));
            reader.readAsDataURL(file);
        });

        const content: Part = {
            inlineData: {
                data: base64EncodedData.split(',')[1],
                mimeType: file.type
            }
        };

        const previewUrl = file.type.startsWith('image/') ? base64EncodedData : undefined;
        return { content, previewUrl };
    };

    const addFiles = async (files: FileList | null) => {
        if (!files || files.length === 0) return;
    
        const results = await Promise.allSettled(
            Array.from(files).map(async file => {
                const { content, previewUrl } = await fileToGenerativePart(file);
                return { file, content, previewUrl };
            })
        );
    
        const newFiles: AttachedFile[] = [];
        const errors: string[] = [];
        results.forEach(result => {
            if (result.status === 'fulfilled') {
                newFiles.push(result.value);
            } else {
                console.error("File processing error:", result.reason);
                errors.push("Não foi possível ler um arquivo. Pode estar corrompido ou em um formato não suportado.");
            }
        });
    
        if (newFiles.length > 0) {
            setAttachedFiles(prev => [...prev, ...newFiles]);
            setNotification({ message: `${newFiles.length} arquivo(s) anexado(s) com sucesso.`, type: 'success' });
        }
    
        if (errors.length > 0) {
            const uniqueErrors = [...new Set(errors)];
            setNotification({ message: uniqueErrors.join(' '), type: 'error' });
        }
    };
    
    const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
        addFiles(event.target.files);
        if (event.target) {
            event.target.value = '';
        }
        textareaRef.current?.focus();
    };
    
    const removeFile = (index: number) => {
        setAttachedFiles(prev => prev.filter((_, i) => i !== index));
    };

    const handleInputChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
        setInput(event.target.value);
        if (proactiveSuggestions.length > 0) {
            setProactiveSuggestions([]);
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
    };

    const handleDragEnter = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsInputAreaDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.relatedTarget && (e.currentTarget as Node).contains(e.relatedTarget as Node)) {
            return;
        }
        setIsInputAreaDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsInputAreaDragging(false);
        setIsWindowDragging(false);
        addFiles(e.dataTransfer.files);
    };

    const handleNewChat = () => {
        const newConversation: Conversation = {
            id: Date.now().toString(),
            title: "Nova Conversa",
            messages: [],
        };
        setConversations(prev => [newConversation, ...prev]);
        setCurrentConversationId(newConversation.id);
        setInput('');
        setAttachedFiles([]);
        setShowSettings(false);
        setIsRefinePanelOpen(false);
        setProactiveSuggestions([]);
    };

    const handleSelectConversation = (id: string) => {
        if (isLoading || editingConversationId) return;
        setCurrentConversationId(id);
        setShowSettings(false);
        setIsRefinePanelOpen(false);
        setProactiveSuggestions([]);
    };

    const handleRenameConversation = (id: string, newTitle: string) => {
        const trimmedTitle = newTitle.trim();
        if (!trimmedTitle) {
            setEditingConversationId(null);
            return;
        }
        setConversations(prev =>
            prev.map(c => (c.id === id ? { ...c, title: trimmedTitle } : c))
        );
        setEditingConversationId(null);
    };

    const handleStartEditing = (convo: Conversation) => {
        setEditingConversationId(convo.id);
        setEditingTitle(convo.title);
    };

    const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setEditingTitle(e.target.value);
    };

    const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, id: string) => {
        if (e.key === 'Enter') {
            handleRenameConversation(id, editingTitle);
        } else if (e.key === 'Escape') {
            setEditingConversationId(null);
        }
    };

    const handleRefineClick = async () => {
        if (!ai || !input.trim() || isLoading) return;
        
        setIsRefining(true);
        setIsRefinePanelOpen(true);
        setRefineData(null);
        setRefineError(null);

        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: input,
                config: {
                    systemInstruction: PROMPT_REFINER_SYSTEM_INSTRUCTION,
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            refined: { type: Type.STRING },
                            questions: { type: Type.ARRAY, items: { type: Type.STRING } },
                            rationale: { type: Type.STRING },
                        },
                        required: ["refined", "rationale"]
                    }
                }
            });

            const parsed = JSON.parse(response.text);
            setRefineData({
                original: input,
                ...parsed
            });

        } catch (error) {
            console.error("Error refining prompt:", error);
            setRefineError("Desculpe, não consegui refinar a pergunta. Por favor, tente novamente.");
        } finally {
            setIsRefining(false);
        }
    };

    const handleApplyRefined = (text: string) => {
        setInput(text);
        setIsRefinePanelOpen(false);
        textareaRef.current?.focus();
    };

    const updateConversationMessages = (conversationId: string, getNewMessages: (currentMessages: Message[]) => Message[]) => {
        setConversations(prev =>
            prev.map(c =>
                c.id === conversationId ? { ...c, messages: getNewMessages(c.messages) } : c
            )
        );
    };

    const generateAndStoreMemory = async (userInput: string, modelResponse: string) => {
        if (!ai) return;
        try {
            const memoryPrompt = `User Query: "${userInput}"\n\nAI Response: "${modelResponse}"`;
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: memoryPrompt,
                config: { systemInstruction: SUMMARIZER_SYSTEM_INSTRUCTION, temperature: 0.2 }
            });
            const newMemory = response.text.trim();
            if (newMemory && newMemory.length > 10) { // Basic validation
                setLongTermMemories(prev => {
                    const updatedMemories = [newMemory, ...prev.filter(m => m !== newMemory)];
                    const MAX_MEMORIES = 20;
                    return updatedMemories.slice(0, MAX_MEMORIES);
                });
            }
        } catch (error) {
            console.error("Failed to generate memory:", error);
            // Fail silently, not a critical feature for the user
        }
    };

    const generateProactiveSuggestions = async (userInput: string, modelResponse: string) => {
        if (!ai) return;
        try {
            const prompt = `--- User Query ---\n${userInput}\n\n--- AI Response ---\n${modelResponse}`;
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: {
                    systemInstruction: PROACTIVE_ASSISTANT_SYSTEM_INSTRUCTION,
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING }
                    }
                }
            });
            const suggestions = JSON.parse(response.text);
            if (Array.isArray(suggestions) && suggestions.length > 0) {
                setProactiveSuggestions(suggestions.slice(0, 3)); // Max 3 suggestions
            }
        } catch (error) {
            console.error("Failed to generate proactive suggestions:", error);
        }
    };
    
    const handleSuggestionClick = (suggestion: string) => {
        handleSubmit(undefined, suggestion);
    };

    const handleShowDetails = (details: GenerationDetails) => {
        setSelectedMessageDetails(details);
        setIsInspectorModalOpen(true);
    };
    
    const handleSearchConfirmation = (confirmedQuery: string) => {
        if (!searchConfirmationData) return;
        
        setShowSearchConfirmation(false);
        
        executeGeneration({
            userInput: searchConfirmationData.originalUserInput,
            attachedFileParts: searchConfirmationData.attachedFileParts,
            history: searchConfirmationData.history,
            confirmedSearchQuery: confirmedQuery
        });

        setSearchConfirmationData(null);
    };

    const handleSearchCancel = () => {
        setShowSearchConfirmation(false);
        setSearchConfirmationData(null);
        setIsLoading(false);
    };
    
    const executeGeneration = async ({ userInput, attachedFileParts, history, confirmedSearchQuery }: { userInput: string; attachedFileParts: Part[]; history: Content[]; confirmedSearchQuery: string | null }) => {
        if (!ai || !currentConversationId) return;

        let contextPrefix = '';
        if (isLongTermMemoryEnabled && longTermMemories.length > 0) {
            const memoryContext = longTermMemories.join('\n- ');
            contextPrefix = `--- Contexto da Memória de Longo Prazo ---\n- ${memoryContext}\n--- Fim do Contexto ---\n\n`;
        }
        const finalInputWithContext = contextPrefix + userInput;
        
        let webContext = '';
        let sources: { uri: string; title: string }[] = [];
        let finalResponseText = '';
        let toolOutputs: ToolOutput[] = [];
        const generationDetails: GenerationDetails = { initial: [], refined: [] };

        if (generationDepth === 'fast') {
            setLoadingTasks([{ name: "Gerando resposta...", icon: <IconBot />, status: 'pending' }]);
        } else {
             let currentTaskTemplate: LoadingTask[];
            switch (researchMode) {
                case 'web': currentTaskTemplate = WEB_RESEARCH_TASKS; break;
                case 'deep': currentTaskTemplate = DEEP_RESEARCH_TASKS; break;
                default: currentTaskTemplate = OFFLINE_TASKS; break;
            }
            let tasksForRun = [...currentTaskTemplate];
            if (!isSelfCorrectionEnabled) {
                tasksForRun = tasksForRun.filter(t => t.name !== CRITIC_TASK.name);
            }
            setLoadingTasks(tasksForRun.map(task => ({ ...task, status: 'pending' })));
        }

        const updateTaskStatus = (index: number, status: TaskStatus) => {
            setLoadingTasks(prev => {
                return prev.map((task, i) => {
                    if (i < index) return { ...task, status: 'completed' };
                    if (i === index) return { ...task, status };
                    return { ...task, status: 'pending' };
                });
            });
        };

        const runTask = async <T,>(taskFn: () => Promise<T>, taskIndex: number): Promise<T> => {
            updateTaskStatus(taskIndex, 'active');
            const startTime = Date.now();
            const result = await taskFn();
            const elapsedTime = Date.now() - startTime;
            const minDisplayTime = 400; 
            if (elapsedTime < minDisplayTime) {
                await new Promise(resolve => setTimeout(resolve, minDisplayTime - elapsedTime));
            }
            updateTaskStatus(taskIndex, 'completed');
            return result;
        };

        try {
            const parseToolOutputs = (response: any): ToolOutput[] => {
                const outputs: ToolOutput[] = [];
                const toolCalls = response.candidates?.[0]?.content?.parts?.filter((p: Part) => 'toolCodeOutputs' in p) ?? [];
                for (const call of toolCalls) {
                    if ('toolCodeOutputs' in call) {
                        for(const toolOutput of call.toolCodeOutputs.outputs) {
                             outputs.push({
                                code: toolOutput.code || 'Código não encontrado',
                                result: toolOutput.outputs || []
                            });
                        }
                    }
                }
                return outputs;
            };

            const codeInterpreterTool: { codeExecution: {} }[] = isCodeInterpreterEnabled ? [{ codeExecution: {} }] : [];

            if (generationDepth === 'fast') {
                updateTaskStatus(0, 'active');
                
                const promptWithContext: Content = {
                    role: 'user',
                    parts: [{ text: finalInputWithContext }, ...attachedFileParts]
                };

                const fastModeTools: ({googleSearch: {}} | {codeExecution: {}})[] = [...codeInterpreterTool];
                if (researchMode === 'web' || researchMode === 'deep') {
                    fastModeTools.push({ googleSearch: {} });
                }

                const finalResponse = await ai.models.generateContent({
                    model: modelName,
                    contents: [...history, promptWithContext],
                    config: { temperature: synthesizerTemp, ...(fastModeTools.length > 0 && {tools: fastModeTools}) }
                });
                finalResponseText = finalResponse.text;
                toolOutputs = parseToolOutputs(finalResponse);

                if (finalResponse.candidates?.[0]?.groundingMetadata?.groundingChunks) {
                    sources = finalResponse.candidates[0].groundingMetadata.groundingChunks
                        .filter(chunk => chunk.web)
                        .map(chunk => ({ uri: chunk.web.uri, title: chunk.web.title }));
                }

                 const modelMessage: Message = {
                    role: 'model',
                    parts: [{ text: finalResponseText }],
                    sources,
                    toolOutputs
                };
                updateTaskStatus(0, 'completed');
                updateConversationMessages(currentConversationId, current => [...current, modelMessage]);

            } else { // Balanced or Deep
                let taskIndex = 0;
                await runTask(() => new Promise(resolve => setTimeout(resolve, 100)), taskIndex);
                taskIndex++;

                if (researchMode === 'web' || researchMode === 'deep') {
                    const queryForSearch = confirmedSearchQuery || finalInputWithContext;
                    const searchResponse = await runTask(() => ai.models.generateContent({
                        model: modelName,
                        contents: queryForSearch,
                        config: { tools: [{ googleSearch: {} }] }
                    }), taskIndex);
                    
                    webContext = `\n\n--- Web Search Results ---\n${searchResponse.text}\n--- End Web Search Results ---`;
                    if (searchResponse.candidates?.[0]?.groundingMetadata?.groundingChunks) {
                        sources = searchResponse.candidates[0].groundingMetadata.groundingChunks
                            .filter(chunk => chunk.web)
                            .map(chunk => ({ uri: chunk.web.uri, title: chunk.web.title }));
                    }
                    taskIndex++;
                }
                
                const promptWithContext: Content = {
                    role: 'user',
                    parts: [{ text: finalInputWithContext + webContext }, ...attachedFileParts]
                };
                
                const numAgents = generationDepth === 'deep' ? 4 : 2;

                const initialResponses = await runTask(() => Promise.all(
                    Array.from({ length: numAgents }).map((_, i) =>
                        ai.models.generateContent({
                            model: modelName,
                            contents: [...history, promptWithContext],
                            config: { systemInstruction: INITIAL_SYSTEM_INSTRUCTION, temperature: initialTemps[i] }
                        })
                    )
                ), taskIndex);
                generationDetails.initial = initialResponses.map(r => r.text);
                taskIndex++;

                const refinedResponses = await runTask(() => Promise.all(
                    initialResponses.map(response =>
                        ai.models.generateContent({
                            model: modelName,
                            contents: [ ...history, { role: 'user', parts: [ ...promptWithContext.parts, { text: "\n\n--- Initial Response to Refine ---\n" + response.text } ] } ],
                            config: { systemInstruction: REFINEMENT_SYSTEM_INSTRUCTION, temperature: refinementTemp }
                        })
                    )
                ), taskIndex);
                generationDetails.refined = refinedResponses.map(r => r.text);
                taskIndex++;
                
                const synthesizerContent: Content = {
                    role: 'user',
                    parts: [
                        ...promptWithContext.parts,
                        ...refinedResponses.map((res, i) => ({ text: `\n\n--- Refined Response ${i + 1} ---\n${res.text}` }))
                    ]
                };

                const synthesizerConfig = {
                    systemInstruction: SYNTHESIZER_SYSTEM_INSTRUCTION,
                    temperature: synthesizerTemp,
                    ...(codeInterpreterTool.length > 0 && {tools: codeInterpreterTool})
                };
                
                let finalResponse = await runTask(() => ai.models.generateContent({
                    model: modelName,
                    contents: [...history, synthesizerContent],
                    config: synthesizerConfig
                }), taskIndex);

                finalResponseText = finalResponse.text;

                if (isSelfCorrectionEnabled) {
                    taskIndex++; // Move to the "Revisão Crítica" step
                    const critiqueResponse = await runTask(async () => {
                        const critiqueContent: Content = {
                            role: 'user',
                            parts: [ ...promptWithContext.parts, { text: "\n\n--- Proposed Final Answer to Critique ---\n" + finalResponse.text } ]
                        };
                        return ai.models.generateContent({
                            model: 'gemini-2.5-flash',
                            contents: [critiqueContent],
                            config: { systemInstruction: CRITIC_SYSTEM_INSTRUCTION, temperature: 0.1 }
                        });
                    }, taskIndex);
            
                    if (critiqueResponse.text.trim().toUpperCase() !== 'PERFECT') {
                        const secondSynthesizerContent: Content = {
                            role: 'user',
                            parts: [
                                ...synthesizerContent.parts,
                                { text: "\n\n--- Critique of Previous Attempt ---\n" + critiqueResponse.text },
                                { text: "\n\n--- Your Task ---\nGenerate a new, superior final response that addresses the critique." }
                            ]
                        };
                        const improvedFinalResponse = await ai.models.generateContent({
                            model: modelName,
                            contents: [...history, secondSynthesizerContent],
                            config: synthesizerConfig
                        });
                        finalResponseText = improvedFinalResponse.text;
                        finalResponse = improvedFinalResponse;
                    }
                }

                toolOutputs = parseToolOutputs(finalResponse);

                const modelMessage: Message = {
                    role: 'model',
                    parts: [{ text: finalResponseText }],
                    sources,
                    toolOutputs,
                    generationDetails
                };
                
                updateTaskStatus(taskIndex, 'completed');
                updateConversationMessages(currentConversationId, current => [...current, modelMessage]);
            }
        } catch (error) {
            console.error("Error during generation:", error);
            let friendlyMessage = "Desculpe, algo deu errado ao gerar a resposta.";
            if (error instanceof Error) {
                if (error.message.includes('API key not valid')) {
                    friendlyMessage = "Há um problema com a configuração da API. Por favor, contate o administrador.";
                } else if (error.message.toLowerCase().includes('deadline')) {
                    friendlyMessage = "A solicitação demorou muito e expirou. Tente novamente com uma pergunta mais curta ou verifique sua conexão de rede.";
                } else if (error.message.includes('SAFETY')) {
                     friendlyMessage = "A resposta foi bloqueada devido às configurações de segurança. Por favor, modifique sua pergunta e tente novamente.";
                }
            }
            finalResponseText = ''; // Ensure no memory is created on error
            const errorMessage: Message = { 
                role: 'model', 
                parts: [{ text: friendlyMessage }],
                isError: true 
            };
            if (currentConversationId) {
                updateConversationMessages(currentConversationId, current => [...current, errorMessage]);
            }
        } finally {
            setIsLoading(false);
            if (finalResponseText) {
                if (isLongTermMemoryEnabled) {
                     generateAndStoreMemory(userInput, finalResponseText);
                }
                generateProactiveSuggestions(userInput, finalResponseText);
            }
        }
    };
    
    const handleSubmit = async (event?: FormEvent, overrideInput?: string) => {
        event?.preventDefault();
        
        const inputToUse = overrideInput ?? input;

        if (!inputToUse.trim() && attachedFiles.length === 0) {
            setNotification({ message: "Por favor, insira uma mensagem ou anexe um arquivo.", type: 'error' });
            return;
        }
        
        if (!ai || !currentConversationId || isLoading) {
            return;
        }

        const userInput = inputToUse;
        setProactiveSuggestions([]);
        
        const userMessage: Message = {
            role: 'user',
            parts: [{ text: userInput }, ...attachedFiles.map(f => f.content)],
            attachedFiles: attachedFiles.map(f => f.file),
        };
        
        const currentConversation = conversations.find(c => c.id === currentConversationId);
        if (!currentConversation) return;

        const MAX_HISTORY_MESSAGES = 10;
        const conversationHistory = currentConversation.messages.slice(-MAX_HISTORY_MESSAGES);
        const history: Content[] = conversationHistory
            .map(msg => ({
                role: msg.role,
                parts: msg.parts.filter((p): p is { text: string } => 
                    'text' in p && typeof p.text === 'string' && p.text.trim() !== ''
                ),
            }))
            .filter(msg => msg.parts.length > 0);
        
        if (currentConversation.messages.length === 0) {
            const newTitle = userInput.trim().substring(0, 40) + (userInput.trim().length > 40 ? '...' : '');
            setConversations(prev =>
                prev.map(c => c.id === currentConversationId ? { ...c, title: newTitle } : c)
            );
        }

        updateConversationMessages(currentConversationId, current => [...current, userMessage]);
        
        const attachedFileParts = attachedFiles.map(f => f.content);

        setInput('');
        setAttachedFiles([]);
        localStorage.removeItem(`draft-input-${currentConversationId}`);

        setIsLoading(true);
        setTimer(0);
        setIsRefinePanelOpen(false);

        if (researchMode === 'web' && generationDepth !== 'fast') {
            try {
                const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: userInput,
                    config: {
                        systemInstruction: SEARCH_REFINER_SYSTEM_INSTRUCTION,
                        responseMimeType: "application/json",
                        responseSchema: {
                            type: Type.OBJECT,
                            properties: {
                                searchQuery: { type: Type.STRING },
                                questions: { type: Type.ARRAY, items: { type: Type.STRING } },
                            },
                            required: ["searchQuery", "questions"]
                        }
                    }
                });
                
                const parsed = JSON.parse(response.text);
                
                setSearchConfirmationData({
                    originalUserInput: userInput,
                    searchQuery: parsed.searchQuery,
                    questions: parsed.questions,
                    attachedFileParts: attachedFileParts,
                    history: history
                });
                setShowSearchConfirmation(true);
                return;
                
            } catch(error) {
                console.error("Error during search refinement:", error);
                const errorMessage: Message = { 
                    role: 'model', 
                    parts: [{ text: "Desculpe, houve um erro ao tentar refinar sua pesquisa. Por favor, tente novamente." }],
                    isError: true 
                };
                updateConversationMessages(currentConversationId, current => [...current, errorMessage]);
                setIsLoading(false);
                return;
            }
        }

        executeGeneration({
            userInput: userInput,
            attachedFileParts: attachedFileParts,
            history: history,
            confirmedSearchQuery: null
        });
    };
    
    const currentMessages = conversations.find(c => c.id === currentConversationId)?.messages ?? [];

    return (
        <div className="app-layout">
             <aside className="sidebar">
                <div className="sidebar-header">
                     <button className="new-chat-button" onClick={handleNewChat}>
                        <IconPlus />
                        Nova Conversa
                    </button>
                </div>
                <nav className="conversation-history">
                    <ul className="conversation-list">
                        {conversations.map(convo => (
                             <li key={convo.id} className={`conversation-list-item ${currentConversationId === convo.id ? 'active' : ''}`}>
                                {editingConversationId === convo.id ? (
                                    <div className="title-editor">
                                        <IconMessageSquare />
                                        <input
                                            type="text"
                                            value={editingTitle}
                                            onChange={handleTitleChange}
                                            onKeyDown={(e) => handleTitleKeyDown(e, convo.id)}
                                            onBlur={() => handleRenameConversation(convo.id, editingTitle)}
                                            autoFocus
                                            onFocus={(e) => e.target.select()}
                                            className="title-edit-input"
                                        />
                                    </div>
                                ) : (
                                    <>
                                        <button
                                            className="conversation-item"
                                            onClick={() => handleSelectConversation(convo.id)}
                                        >
                                            <IconMessageSquare />
                                            <span className="conversation-title">{convo.title}</span>
                                        </button>
                                        {currentConversationId === convo.id && (
                                            <button
                                                className="rename-button"
                                                onClick={() => handleStartEditing(convo)}
                                                aria-label="Renomear conversa"
                                            >
                                                <IconEdit />
                                            </button>
                                        )}
                                    </>
                                )}
                            </li>
                        ))}
                    </ul>
                </nav>
            </aside>
            <main className="chat-container">
                <MemoryManagementModal 
                    isOpen={showMemoryModal}
                    onClose={() => setShowMemoryModal(false)}
                    memories={longTermMemories}
                    onAdd={(memory) => setLongTermMemories(prev => [memory, ...prev])}
                    onDelete={(index) => setLongTermMemories(prev => prev.filter((_, i) => i !== index))}
                    onClearAll={() => setLongTermMemories([])}
                />
                 <GenerationInspectorModal
                    isOpen={isInspectorModalOpen}
                    onClose={() => setIsInspectorModalOpen(false)}
                    details={selectedMessageDetails}
                />
                <SearchConfirmationModal
                    isOpen={showSearchConfirmation}
                    onConfirm={handleSearchConfirmation}
                    onCancel={handleSearchCancel}
                    data={searchConfirmationData ? { searchQuery: searchConfirmationData.searchQuery, questions: searchConfirmationData.questions } : null}
                />
                {isWindowDragging && (
                     <div className="window-drag-overlay">
                        <div className="window-drag-overlay-content">
                            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
                            <span>Solte os Arquivos para Anexar</span>
                        </div>
                    </div>
                )}
                <header>
                    <h1>Gemini Heavy</h1>
                </header>
                <div className="message-list" ref={messageListRef}>
                     {currentMessages.map((msg, index) => (
                        <div key={index} className={`message-wrapper ${msg.role === 'user' ? 'user-wrapper' : 'model-wrapper'}`}>
                            <div className={`avatar ${msg.role === 'user' ? 'user-avatar' : 'model-avatar'}`}>
                                {msg.role === 'user' ? <span>U</span> : <IconBot />}
                            </div>
                            <div className="message-content-wrapper">
                                <div className={`message ${msg.role} ${msg.isError ? 'message--error' : ''}`}>
                                    <div className="message-header">
                                        {msg.role === 'model' && !msg.isError && <div className="agent-label">Agente Sintetizador</div>}
                                        {msg.isError && <div className="agent-label error-label"><IconAlertTriangle/> Erro</div>}
                                    </div>
                                    {msg.attachedFiles && msg.attachedFiles.length > 0 && <AttachmentDisplay files={msg.attachedFiles} />}
                                    <ReactMarkdown
                                        remarkPlugins={[remarkGfm]}
                                        components={{
                                            p: ({node, ...props}) => <p style={{marginBottom: '0.75rem'}} {...props} />,
                                            pre: ({ node, ...props }) => <CodeBlock {...props} />,
                                        }}
                                    >
                                        {msg.parts.map(part => 'text' in part ? part.text : '').join('')}
                                    </ReactMarkdown>
                                    {msg.toolOutputs && msg.toolOutputs.length > 0 && (
                                        <div className="tool-outputs-container">
                                            {msg.toolOutputs.map((output, i) => (
                                                <CodeExecutionBlock key={i} output={output} />
                                            ))}
                                        </div>
                                    )}
                                    {msg.sources && <SourcesDisplay sources={msg.sources} />}
                                </div>
                                {msg.role === 'model' && !msg.isError && (
                                    <div className="message-actions-toolbar">
                                        {msg.generationDetails && (
                                            <button className="message-action-button" onClick={() => handleShowDetails(msg.generationDetails!)} aria-label="Ver detalhes da geração">
                                                <IconLayers/>
                                            </button>
                                        )}
                                        <MessageCopyButton text={msg.parts.map(part => 'text' in part ? part.text : '').join('')} />
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                    {isLoading && <LoadingIndicator 
                        tasks={loadingTasks} 
                        timer={timer}
                        activeTaskName={loadingTasks.find(t => t.status === 'active')?.name}
                    />}
                    {!isLoading && currentMessages.length > 0 && (
                        <ProactiveSuggestions key={currentConversationId} suggestions={proactiveSuggestions} onSelect={handleSuggestionClick} />
                    )}
                </div>
                <div 
                    className={`input-area-padding ${isInputAreaDragging ? 'drag-over-active' : ''}`}
                    onDragEnter={handleDragEnter}
                    onDragLeave={handleDragLeave}
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                >
                     {notification && (
                        <Notification 
                            message={notification.message}
                            type={notification.type}
                            onDismiss={() => setNotification(null)}
                        />
                     )}
                     {isRefinePanelOpen && (
                        <RefinePanel 
                            data={refineData} 
                            isRefining={isRefining} 
                            error={refineError}
                            onApply={handleApplyRefined}
                            onClose={() => setIsRefinePanelOpen(false)}
                        />
                     )}
                    {showSettings && (
                         <div className="settings-panel">
                            <button type="button" className="settings-close-button" onClick={() => setShowSettings(false)} aria-label="Fechar configurações">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                            </button>
                            
                            <CollapsibleSection title="Model & Research" isOpen={openSettingsSections.model} onToggle={() => toggleSection('model')}>
                                <div className="settings-group">
                                    <h3 className="settings-group-title">Modo de Pesquisa</h3>
                                    <div className="model-selector-container">
                                        <button className={`model-select-button ${researchMode === 'offline' ? 'active' : ''}`} onClick={() => setResearchMode('offline')}>Offline</button>
                                        <button className={`model-select-button ${researchMode === 'web' ? 'active' : ''}`} onClick={() => setResearchMode('web')}>Web</button>
                                        <button className={`model-select-button ${researchMode === 'deep' ? 'active' : ''}`} onClick={() => setResearchMode('deep')}>Deep</button>
                                    </div>
                                </div>
                                <div className="settings-group">
                                    <h3 className="settings-group-title">Modelo</h3>
                                    <div className="model-selector-container">
                                        <button className={`model-select-button ${modelName === 'gemini-2.5-pro' ? 'active' : ''}`} onClick={() => setModelName('gemini-2.5-pro')}>Pro</button>
                                        <button className={`model-select-button ${modelName === 'gemini-2.5-flash' ? 'active' : ''}`} onClick={() => setModelName('gemini-2.5-flash')}>Flash</button>
                                    </div>
                                </div>
                            </CollapsibleSection>
                            
                            <CollapsibleSection title="Agent Behavior" isOpen={openSettingsSections.agents} onToggle={() => toggleSection('agents')}>
                                <div className="settings-group">
                                    <h3 className="settings-group-title">Qualidade da Resposta</h3>
                                    <div className="setting-item">
                                        <label htmlFor="self-correction-toggle">Ciclo de Autocorreção</label>
                                        <label className="switch">
                                            <input type="checkbox" id="self-correction-toggle" checked={isSelfCorrectionEnabled} onChange={() => setIsSelfCorrectionEnabled(!isSelfCorrectionEnabled)} />
                                            <span className="slider round"></span>
                                        </label>
                                    </div>
                                </div>
                                <div className="settings-group">
                                    <h3 className="settings-group-title">Agentes Iniciais</h3>
                                    {initialTemps.map((temp, i) => (
                                        <div key={i} className="temp-slider-container">
                                            <label htmlFor={`initial-temp-${i}`}>Temperatura Agente Inicial {i + 1}</label>
                                            <div className="slider-wrapper">
                                                <input
                                                    type="range" id={`initial-temp-${i}`} min="0" max="1" step="0.1"
                                                    value={temp} onChange={(e) => {
                                                        const newTemps = [...initialTemps];
                                                        newTemps[i] = parseFloat(e.target.value);
                                                        setInitialTemps(newTemps);
                                                    }}
                                                />
                                                <span>{temp.toFixed(1)}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <div className="settings-group">
                                    <h3 className="settings-group-title">Agente de Refinamento</h3>
                                    <div className="temp-slider-container">
                                        <label htmlFor="refinement-temp">Temperatura Agente de Refinamento</label>
                                        <div className="slider-wrapper">
                                            <input type="range" id="refinement-temp" min="0" max="1" step="0.1" value={refinementTemp} onChange={(e) => setRefinementTemp(parseFloat(e.target.value))} />
                                            <span>{refinementTemp.toFixed(1)}</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="settings-group">
                                    <h3 className="settings-group-title">Agente Sintetizador</h3>
                                    <div className="temp-slider-container">
                                        <label htmlFor="synthesizer-temp">Temperatura Agente Sintetizador</label>
                                        <div className="slider-wrapper">
                                            <input type="range" id="synthesizer-temp" min="0" max="1" step="0.1" value={synthesizerTemp} onChange={(e) => setSynthesizerTemp(parseFloat(e.target.value))} />
                                            <span>{synthesizerTemp.toFixed(1)}</span>
                                        </div>
                                    </div>
                                </div>
                            </CollapsibleSection>
                            
                            <CollapsibleSection title="Tools" isOpen={openSettingsSections.tools} onToggle={() => toggleSection('tools')}>
                                <div className="settings-group">
                                    <h3 className="settings-group-title">Ferramentas</h3>
                                    <div className="setting-item">
                                        <label htmlFor="code-interpreter-toggle">Interpretador de Código</label>
                                        <label className="switch">
                                            <input type="checkbox" id="code-interpreter-toggle" checked={isCodeInterpreterEnabled} onChange={() => setIsCodeInterpreterEnabled(!isCodeInterpreterEnabled)} />
                                            <span className="slider round"></span>
                                        </label>
                                    </div>
                                </div>
                            </CollapsibleSection>

                            <CollapsibleSection title="Memory" isOpen={openSettingsSections.memory} onToggle={() => toggleSection('memory')}>
                                <div className="settings-group">
                                    <h3 className="settings-group-title">Memória de Longo Prazo</h3>
                                    <div className="setting-item">
                                        <label htmlFor="ltm-toggle">Ativar Memória</label>
                                        <label className="switch">
                                            <input type="checkbox" id="ltm-toggle" checked={isLongTermMemoryEnabled} onChange={() => setIsLongTermMemoryEnabled(!isLongTermMemoryEnabled)} />
                                            <span className="slider round"></span>
                                        </label>
                                    </div>
                                    <div className="setting-item">
                                         <label>Gerenciar Memórias Salvas</label>
                                        <button className="manage-memory-button" onClick={() => setShowMemoryModal(true)}>
                                            Gerenciar
                                        </button>
                                    </div>
                                </div>
                            </CollapsibleSection>
                        </div>
                    )}
                    <form onSubmit={handleSubmit} className={`input-wrapper ${isInputAreaDragging ? 'drag-active' : ''}`}>
                         <div className="input-main">
                             {attachedFiles.length > 0 && (
                                <div className="attachment-preview-container">
                                    {attachedFiles.map((file, index) => (
                                        <div key={index} className="attachment-pill" title={file.file.name}>
                                            {file.previewUrl ? (
                                                <img src={file.previewUrl} alt={file.file.name} className="attachment-image-preview" />
                                            ) : getFileTypeIcon(file.file.type)}
                                            <div className="attachment-file-info">
                                                <div className="attachment-filename">{file.file.name}</div>
                                                <div className="attachment-filesize">{formatFileSize(file.file.size)}</div>
                                            </div>
                                            <button type="button" onClick={() => removeFile(index)} className="remove-file-button" aria-label={`Remover ${file.file.name}`}>
                                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                            <textarea
                                ref={textareaRef}
                                value={input}
                                onChange={handleInputChange}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        handleSubmit();
                                    }
                                }}
                                placeholder="Pergunte qualquer coisa..."
                                rows={1}
                                disabled={isLoading}
                            />
                        </div>
                        <div className="input-actions">
                            <div className="action-buttons-left">
                                <button type="button" className="action-button" onClick={() => fileInputRef.current?.click()} disabled={isLoading} aria-label="Anexar arquivo">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.122 2.122l7.81-7.81" />
                                    </svg>
                                </button>
                                <input type="file" ref={fileInputRef} onChange={handleFileChange} style={{ display: 'none' }} multiple />
                                 <button type="button" className="action-button" onClick={handleRefineClick} disabled={isLoading || !input.trim()}>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.93 2.25 12 7.33l2.07-5.08"/><path d="M5.22 5.22 8.5 8.5"/><path d="M2.25 9.93 7.33 12l-5.08 2.07"/><path d="M5.22 18.78 8.5 15.5"/><path d="M9.93 21.75 12 16.67l2.07 5.08"/><path d="M18.78 18.78 15.5 15.5"/><path d="M21.75 14.07 16.67 12l5.08-2.07"/><path d="M18.78 5.22 15.5 8.5"/></svg>
                                    <span>Refinar</span>
                                </button>
                                <div className="depth-selector">
                                    <button type="button" className={`depth-button ${generationDepth === 'fast' ? 'active' : ''}`} onClick={() => setGenerationDepth('fast')} disabled={isLoading} title="Modo Rápido: Resposta direta de um único agente.">
                                        <IconZap />
                                        <span>Rápido</span>
                                    </button>
                                    <button type="button" className={`depth-button ${generationDepth === 'balanced' ? 'active' : ''}`} onClick={() => setGenerationDepth('balanced')} disabled={isLoading} title="Modo Balanceado: Resposta de 5 agentes.">
                                        <IconBalance />
                                        <span>Balanceado</span>
                                    </button>
                                    <button type="button" className={`depth-button ${generationDepth === 'deep' ? 'active' : ''}`} onClick={() => setGenerationDepth('deep')} disabled={isLoading} title="Modo Profundo: Resposta de 9 agentes para máxima qualidade.">
                                        <IconBrainCircuit />
                                        <span>Profundo</span>
                                    </button>
                                </div>
                                <button type="button" className="action-button" onClick={() => setShowSettings(!showSettings)} disabled={isLoading} aria-label="Configurações">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 0 2l-.15.08a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1 0-2l.15-.08a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
                                </button>
                            </div>
                            <button type="submit" className="send-button" disabled={isLoading || (!input.trim() && attachedFiles.length === 0)} aria-label="Enviar">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18" />
                                </svg>
                            </button>
                        </div>
                    </form>
                </div>
            </main>
        </div>
    );
};

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<App />);
}