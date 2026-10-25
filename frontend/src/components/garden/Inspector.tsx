import { useEffect, useState } from 'react'
import WebsiteTopicEditor from '../../tree/WebsiteTopicEditor'

export default function Inspector() {
  const [inspectedId, setInspectedId] = useState<string | null>(null)

  useEffect(() => {
    const handleInspect = (event: Event) => {
      const categoryId = (event as CustomEvent<string>).detail

      if (categoryId) {
        setInspectedId(categoryId)
      }
    }

    window.addEventListener('prune:inspect-topic', handleInspect)

    return () => {
      window.removeEventListener('prune:inspect-topic', handleInspect)
    }
  }, [])

  if (!inspectedId) {
    return null
  }

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
            Take a closer look at what's growing in your feed.
            Organize your interests and make room for the
            content you want to see.
          </p>
        </div>

        <button
          type="button"
          className="botanical-topic-editor__close"
          onClick={() => setInspectedId(null)}
          aria-label="Close topic editor"
        >
          Close ×
        </button>
      </div>

      <WebsiteTopicEditor inspectedId={inspectedId} />
    </section>
  )
}
