import { useEffect, useState } from 'react'
import WebsiteTopicEditor from '../../tree/WebsiteTopicEditor'

export default function Inspector() {
  const [inspectedId, setInspectedId] = useState<string | null>(null)

  useEffect(() => {
    const handleInspect = (event: Event) => {
      const categoryId = (event as CustomEvent<string>).detail

      if (!categoryId) return

      setInspectedId(categoryId)

      window.requestAnimationFrame(() => {
        document
          .getElementById('garden-topic-editor')
          ?.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
          })
      })
    }

    window.addEventListener('prune:inspect-topic', handleInspect)

    return () => {
      window.removeEventListener('prune:inspect-topic', handleInspect)
    }
  }, [])

  return (
    <section
      className="inspector inspector--topic-editor botanical-topic-editor"
      aria-label="Explore and manage topics"
    >
      <div className="botanical-topic-editor__header">
        <div>
          <span className="botanical-eyebrow">
            CULTIVATE YOUR INTERESTS
          </span>

          <h2>Explore &amp; manage topics</h2>

          <p>
            {inspectedId
              ? 'Explore this topic, its subtopics, and watched videos.'
              : "Explore what's growing in your feed, inspect videos, and prune topics you want to see less often."}
          </p>
        </div>

        {inspectedId ? (
          <button
            type="button"
            className="botanical-topic-editor__close"
            onClick={() => setInspectedId(null)}
          >
            Show all topics ×
          </button>
        ) : (
          <span
            className="botanical-topic-editor__flourish"
            aria-hidden="true"
          >
            ❧
          </span>
        )}
      </div>

      <WebsiteTopicEditor inspectedId={inspectedId} />
    </section>
  )
}
