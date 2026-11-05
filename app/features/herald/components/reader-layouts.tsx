import { ArrowUpRightIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "~/shared/lib/utils";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/shared/ui/empty";
import type { HeraldArticle } from "../model/types";

export function StoryCard({
  article,
  onRead,
  variant = "standard",
  priority = false,
}: {
  article: HeraldArticle;
  onRead: (article: HeraldArticle) => void;
  variant?: "lead" | "standard" | "compact" | "hero";
  priority?: boolean;
}) {
  return (
    <article className={cn("herald-story", "herald-story-" + variant)}>
      <button
        className="herald-story-link"
        onClick={() => onRead(article)}
        aria-label={"Read: " + article.title}
      >
        <div className="herald-story-image">
          <img
            src={article.image}
            alt=""
            width={1000}
            height={700}
            loading={priority ? "eager" : "lazy"}
            fetchPriority={priority ? "high" : "auto"}
          />
        </div>
        <div className="herald-story-copy">
          <span className="herald-kicker">{article.category}</span>
          <h3>{article.title}</h3>
          {variant !== "hero" ? <p>{article.deck}</p> : null}
          <div className="herald-byline">
            <span>Minjok Herald</span>
            <span>{article.date}</span>
          </div>
          {variant === "lead" ? (
            <span className="herald-read-story">
              Read the story <ArrowUpRightIcon aria-hidden className="size-4" />
            </span>
          ) : null}
        </div>
      </button>
    </article>
  );
}

export function ReaderLayout({
  layout,
  articles,
  onRead,
  sidebar,
}: {
  layout: "classic" | "magazine";
  articles: HeraldArticle[];
  onRead: (article: HeraldArticle) => void;
  sidebar: ReactNode;
}) {
  const [lead, second, third, ...rest] = articles;
  if (!lead)
    return (
      <div className="herald-content-grid">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No stories here yet</EmptyTitle>
            <EmptyDescription>
              Try another section or publish the first story.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
        <aside>{sidebar}</aside>
      </div>
    );

  return layout === "classic" ? (
    <div className="herald-classic-grid">
      <div className="herald-classic-main">
        <div className="herald-section-heading">
          <h2>The front page</h2>
          <span>STORIES THAT STAY WITH YOU</span>
        </div>
        <div className="herald-classic-columns">
          <StoryCard article={lead} onRead={onRead} variant="lead" priority />
          <div className="herald-classic-secondary">
            {second ? <StoryCard article={second} onRead={onRead} /> : null}
            {third ? <StoryCard article={third} onRead={onRead} /> : null}
          </div>
        </div>
        {rest.length > 0 ? (
          <section className="herald-more-stories">
            <div className="herald-section-heading">
              <h2>Around the school</h2>
              <span>THE LATEST</span>
            </div>
            <div className="herald-story-grid">
              {rest.map((article) => (
                <StoryCard key={article.id} article={article} onRead={onRead} />
              ))}
            </div>
          </section>
        ) : null}
      </div>
      <aside className="herald-sidebar">{sidebar}</aside>
    </div>
  ) : (
    <div className="herald-magazine-layout">
      <div className="herald-magazine-heroes">
        <StoryCard article={lead} onRead={onRead} variant="hero" priority />
        <div>
          {second ? (
            <StoryCard article={second} onRead={onRead} variant="hero" />
          ) : null}
          {third ? (
            <StoryCard article={third} onRead={onRead} variant="hero" />
          ) : null}
        </div>
      </div>
      <div className="herald-content-grid">
        <section>
          <div className="herald-section-heading">
            <h2>More from the Herald</h2>
            <span>FRESH PERSPECTIVES</span>
          </div>
          <div className="herald-magazine-list">
            {rest.map((article) => (
              <StoryCard
                key={article.id}
                article={article}
                onRead={onRead}
                variant="compact"
              />
            ))}
          </div>
        </section>
        <aside className="herald-sidebar">{sidebar}</aside>
      </div>
    </div>
  );
}
