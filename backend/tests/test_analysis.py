import unittest
from unittest.mock import Mock, patch

import httpx

from analysis.analyzer import SentimentAnalyzer, preprocess
from app.youtube import Comment, YouTubeError, fetch_video_comments, parse_comments


def resource(comment_id, text):
    return {"id": comment_id, "snippet": {"textOriginal": text}}


def scores(label):
    return [{"label": key.title(), "score": 0.8 if key == label else 0.1}
            for key in ("negative", "neutral", "positive")]


class ParsingTests(unittest.TestCase):
    def test_threads_replies_duplicates_and_empty_text(self):
        response = {"items": [
            {"snippet": {"topLevelComment": resource("a", "top")},
             "replies": {"comments": [resource("b", "reply")]}},
            resource("a", "duplicate"), resource("c", "  "),
        ]}
        self.assertEqual(parse_comments(response), [Comment("a", "top"), Comment("b", "reply")])

    def test_html_fallback_and_original_text_preserved(self):
        response = {"items": [
            {"id": "a", "snippet": {"textDisplay": "Bad<br>video &amp; <b>editing</b>"}},
            resource("b", "I <3 this &amp; that"),
        ]}
        self.assertEqual([c.text for c in parse_comments(response)],
                         ["Bad video & editing", "I <3 this &amp; that"])

    def test_invalid_response(self):
        for response in ({}, {"items": None}, {"items": [{}]},
                         {"items": [{"snippet": {}}]}):
            with self.subTest(response=response), self.assertRaises(ValueError):
                parse_comments(response)

    def test_preprocessing(self):
        self.assertEqual(preprocess("Hey @alice see https://example.com"), "Hey @user see http")


class AnalysisTests(unittest.TestCase):
    def analyze_labels(self, labels, threshold=0.5):
        classifier = Mock(return_value=[scores(label) for label in labels])
        result = SentimentAnalyzer(classifier).analyze(
            [Comment(str(i), f"comment {i}") for i in range(len(labels))], threshold)
        return result, classifier

    def test_negative_majority_scores_and_balance(self):
        result, classifier = self.analyze_labels(["negative", "negative", "positive"])
        summary = result["summary"]
        self.assertTrue(summary["is_negative_reaction"])
        self.assertEqual(summary["counts"], {"negative": 2, "neutral": 0, "positive": 1})
        self.assertAlmostEqual(summary["average_scores"]["negative"], 1.7 / 3)
        self.assertAlmostEqual(summary["sentiment_balance"], -1 / 3)
        self.assertEqual(result["comments"][0]["sentiment"], "negative")
        self.assertEqual(classifier.call_args.kwargs["max_length"], 512)
        self.assertIsNone(classifier.call_args.kwargs["top_k"])

    def test_neutral_positive_ties_and_threshold(self):
        for labels, threshold, expected in [
            (["neutral"] * 3, 0.5, False),
            (["positive"] * 3, 0.5, False),
            (["negative", "positive"], 0.5, False),
            (["negative", "neutral"], 0.5, True),
            (["negative", "neutral"], 0.75, False),
        ]:
            with self.subTest(labels=labels, threshold=threshold):
                result, _ = self.analyze_labels(labels, threshold)
                self.assertEqual(result["summary"]["is_negative_reaction"], expected)

    def test_balance_excludes_neutral_comments(self):
        cases = [
            (["negative"] * 10 + ["neutral"] * 90, -1.0),
            (["negative"] * 10, -1.0),
            (["positive"] * 3 + ["negative"] + ["neutral"] * 96, 0.5),
            (["negative", "positive"] + ["neutral"] * 10, 0.0),
            (["positive"] + ["neutral"] * 99, 1.0),
            (["negative"] + ["neutral"] * 99, -1.0),
            (["neutral"] * 100, None),
            ([], None),
        ]
        for labels, expected in cases:
            with self.subTest(expected=expected, count=len(labels)):
                # Give this test a single batch so the mock aligns with inputs.
                analyzer = SentimentAnalyzer(Mock(return_value=[scores(label) for label in labels]), batch_size=100)
                result = analyzer.analyze([Comment(str(i), "text") for i in range(len(labels))])
                self.assertEqual(result["summary"]["sentiment_balance"], expected)

    def test_balance_depends_on_counts_rather_than_confidence(self):
        low_confidence = [
            [{"label": "negative", "score": 0.35}, {"label": "neutral", "score": 0.33}, {"label": "positive", "score": 0.32}],
            scores("positive"),
        ]
        result = SentimentAnalyzer(Mock(return_value=low_confidence)).analyze([Comment("a", "text"), Comment("b", "text")])
        self.assertEqual(result["summary"]["sentiment_balance"], 0.0)

    def test_empty_input_does_not_load_model(self):
        analyzer = SentimentAnalyzer()
        with patch.object(analyzer, "_load") as load:
            summary = analyzer.analyze_response({"items": []})["summary"]
        load.assert_not_called()
        self.assertIsNone(summary["is_negative_reaction"])
        self.assertIsNone(summary["sentiment_balance"])
        self.assertEqual(summary["assessment"], "insufficient_data")

    def test_batching_keeps_comment_ids_aligned(self):
        classifier = Mock(side_effect=[[scores("negative"), scores("positive")], [scores("neutral")]])
        result = SentimentAnalyzer(classifier, batch_size=2).analyze(
            [Comment(str(i), "text") for i in range(3)])
        self.assertEqual([row["id"] for row in result["comments"]], ["0", "1", "2"])
        self.assertEqual(classifier.call_count, 2)

    def test_invalid_threshold(self):
        for threshold in (0, -1, 1.1, float("nan")):
            with self.assertRaises(ValueError):
                SentimentAnalyzer().analyze([], threshold)


class YouTubeTests(unittest.TestCase):
    @patch("app.youtube.httpx.Client")
    def test_pagination_and_sample_limit(self, client_class):
        first = {"items": [{"snippet": {"topLevelComment": resource(str(i), "text")}}
                           for i in range(100)], "nextPageToken": "page2"}
        second = {"items": [{"snippet": {"topLevelComment": resource("100", "last")}}],
                  "nextPageToken": "page3"}
        client = client_class.return_value.__enter__.return_value
        client.get.side_effect = [Mock(json=Mock(return_value=page)) for page in (first, second)]
        result = fetch_video_comments("abcdefghijk", "test-key", 101)
        self.assertEqual(len(parse_comments(result)), 101)
        self.assertEqual(result["nextPageToken"], "page3")
        self.assertEqual(client.get.call_args.kwargs["params"]["pageToken"], "page2")
        self.assertEqual(client.get.call_args.kwargs["params"]["maxResults"], 1)
        self.assertEqual(client.get.call_args.kwargs["params"]["order"], "time")

    @patch("app.youtube.httpx.Client")
    def test_upstream_error_does_not_leak_key(self, client_class):
        request = httpx.Request("GET", "https://example.com?key=secret")
        response = httpx.Response(403, request=request)
        client = client_class.return_value.__enter__.return_value
        client.get.side_effect = httpx.HTTPStatusError("denied", request=request, response=response)
        with self.assertRaises(YouTubeError) as raised:
            fetch_video_comments("abcdefghijk", "secret")
        self.assertNotIn("secret", str(raised.exception))
        self.assertIn("403", str(raised.exception))
        self.assertEqual(raised.exception.status_code, 403)

    @patch("app.youtube.httpx.Client")
    def test_empty_and_malformed_upstream_response(self, client_class):
        client = client_class.return_value.__enter__.return_value
        client.get.return_value.json.return_value = {"items": []}
        self.assertEqual(fetch_video_comments("abcdefghijk", "key")["items"], [])
        client.get.return_value.json.return_value = {"unexpected": True}
        with self.assertRaises(YouTubeError):
            fetch_video_comments("abcdefghijk", "key")


if __name__ == "__main__":
    unittest.main()
