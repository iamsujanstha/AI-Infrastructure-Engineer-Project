import io
from types import SimpleNamespace

import local_cli


class InteractiveInput(io.StringIO):
    def isatty(self):
        return True


def test_interactive_chat_carries_history_until_explicit_reset(monkeypatch, capsys):
    monkeypatch.setattr(
        "sys.stdin",
        InteractiveInput("Who am I?\nWhat did I ask?\n:reset\nFresh question\n:quit\n"),
    )
    observed = []

    def generate(prompt, *, history):
        observed.append((prompt, list(history)))
        return SimpleNamespace(
            text=f"answer to {prompt}",
            prompt_token_estimate=300,
            reserved_output_tokens=512,
            context_window_tokens=8192,
        )

    monkeypatch.setattr(local_cli, "generate", generate)

    assert local_cli.interactive_chat() == 0
    assert observed == [
        ("Who am I?", []),
        ("What did I ask?", [
            {"role": "user", "content": "Who am I?"},
            {"role": "assistant", "content": "answer to Who am I?"},
        ]),
        ("Fresh question", []),
    ]
    assert "Conversation context cleared." in capsys.readouterr().out
