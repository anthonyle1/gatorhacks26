import { TopicGarden } from './TopicGarden'

declare global {
  interface Window { TopicGarden: typeof TopicGarden }
}
window.TopicGarden = TopicGarden
// Session/audio controls remain the extension's existing script; start them after
// the React topic garden is available, including in the packaged extension.
const script = document.createElement('script')
script.src = new URL('sidepanel.js', document.baseURI).href
document.body.append(script)
