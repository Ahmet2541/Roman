"""SONUÇ kutusu otomatik doldurma (set_draft_result) ve iteratif düzenleme
(current_result context enjeksiyonu) - kullanıcı 'daha iyi bir betimleme
yaz' dediğinde AI'nın taslağı otomatik SONUÇ kutusuna yazması, sonra 'ev
değil bina yap' gibi bir düzenleme isteğinde önceki taslağın TAMAMINI
güncelleyerek geri dönmesi gerekiyor."""
from unittest.mock import patch, MagicMock
import json


def _tool_call_response(name, args):
    tc = MagicMock()
    tc.id = "call_1"
    tc.function.name = name
    tc.function.arguments = json.dumps(args)
    msg = MagicMock(content="", tool_calls=[tc])
    return MagicMock(choices=[MagicMock(message=msg)])


def _final_response(text):
    msg = MagicMock(content=text, tool_calls=None)
    return MagicMock(choices=[MagicMock(message=msg)])


def test_set_draft_result_populates_draft_result_field(client, headers):
    with patch("app.qwen_client.get_client") as mock_get_client:
        mock_client = MagicMock()
        mock_client.chat.completions.create.side_effect = [
            _tool_call_response("set_draft_result", {"text": "Şehrin kalbinde bir ev vardı."}),
            _final_response("Güncelledim."),
        ]
        mock_get_client.return_value = mock_client

        r = client.post("/ai/chat", json={
            "messages": [{"role": "user", "content": "Daha iyi bir betimleme yaz"}],
            "selected_entities": [], "current_result": None,
        }, headers=headers)
        assert r.status_code == 200
        assert r.json()["draft_result"] == "Şehrin kalbinde bir ev vardı."


def test_chat_without_draft_tool_leaves_draft_result_none(client, headers):
    with patch("app.qwen_client.get_client") as mock_get_client:
        mock_client = MagicMock()
        mock_client.chat.completions.create.side_effect = [_final_response("Sadece sohbet ediyoruz.")]
        mock_get_client.return_value = mock_client

        r = client.post("/ai/chat", json={
            "messages": [{"role": "user", "content": "Ahmet ne zaman doğdu dersin?"}],
            "selected_entities": [], "current_result": None,
        }, headers=headers)
        assert r.status_code == 200
        assert r.json()["draft_result"] is None


def test_current_result_is_injected_into_context_for_edit_requests(client, headers):
    """Kullanıcı 'ev değil bina yap' derse, AI'nin önceki taslağı GÖRMESİ
    lazım - current_result payload'dan system mesajına doğru enjekte
    ediliyor mu diye kontrol ediyoruz."""
    with patch("app.qwen_client.get_client") as mock_get_client:
        mock_client = MagicMock()
        mock_client.chat.completions.create.side_effect = [
            _tool_call_response("set_draft_result", {"text": "Şehrin kalbinde bir bina vardı."}),
            _final_response("Güncelledim."),
        ]
        mock_get_client.return_value = mock_client

        r = client.post("/ai/chat", json={
            "messages": [
                {"role": "user", "content": "Daha iyi bir betimleme yaz"},
                {"role": "assistant", "content": "Güncelledim."},
                {"role": "user", "content": "ev değil bina yap"},
            ],
            "selected_entities": [], "current_result": "Şehrin kalbinde bir ev vardı.",
        }, headers=headers)
        assert r.status_code == 200
        assert r.json()["draft_result"] == "Şehrin kalbinde bir bina vardı."

        system_msg = mock_client.chat.completions.create.call_args_list[0].kwargs["messages"][0]["content"]
        assert "ŞU AN SONUÇ KUTUSUNDA" in system_msg
        assert "bir ev vardı" in system_msg
