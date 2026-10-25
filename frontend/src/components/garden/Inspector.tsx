import WebsiteTopicEditor from '../../tree/WebsiteTopicEditor'

export default function Inspector() {
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

        <span
          className="botanical-topic-editor__flourish"
          aria-hidden="true"
        >
          ❧
        </span>
      </div>

      <WebsiteTopicEditor />
    </section>
  )
}
