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

  // Hide the topic editor until a category is inspected.
  if (!inspectedId) {
    return null
  }

  return (
    <section
      className="card card--lg inspector inspector--topic-editor"
      aria-label="Explore and manage topics"
    >
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          className="btn btn--outline-soft"
          onClick={() => setInspectedId(null)}
        >
          Close ×
        </button>
      </div>

      <WebsiteTopicEditor inspectedId={inspectedId} />
    </section>
  )
}