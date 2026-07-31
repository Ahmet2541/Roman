"""EncryptedJSON'ın dict/list ayrımı için düzelttiğimiz hatayı kalıcı
olarak koruma altına alan testler - bkz. proje sohbet geçmişi: NULL bir
'aliases' sütunu yanlışlıkla {} dönüyordu, [] dönmesi gerekiyordu."""
from app.encryption import EncryptedJSON


def test_encrypted_json_none_returns_configured_default_dict():
    field = EncryptedJSON(default_empty=dict)
    assert field.process_result_value(None, None) == {}


def test_encrypted_json_none_returns_configured_default_list():
    field = EncryptedJSON(default_empty=list)
    assert field.process_result_value(None, None) == []


def test_encrypted_json_dict_default_is_dict_by_default():
    # default_empty verilmezse (ör. Character.sections gibi eski kullanım)
    # geriye dönük uyumluluk için dict olmalı.
    field = EncryptedJSON()
    assert field.process_result_value(None, None) == {}


def test_encrypted_json_round_trip_dict():
    field = EncryptedJSON(default_empty=dict)
    encrypted = field.process_bind_param({"gecmis": "eski bir savaşta yaralandı"}, None)
    assert encrypted is not None
    assert "gecmis" not in encrypted  # düz metin sızmamalı
    decrypted = field.process_result_value(encrypted, None)
    assert decrypted == {"gecmis": "eski bir savaşta yaralandı"}


def test_encrypted_json_round_trip_list():
    field = EncryptedJSON(default_empty=list)
    encrypted = field.process_bind_param(["Kral", "Majesteleri"], None)
    assert encrypted is not None
    assert "Kral" not in encrypted  # düz metin sızmamalı
    decrypted = field.process_result_value(encrypted, None)
    assert decrypted == ["Kral", "Majesteleri"]


def test_encrypted_json_invalid_token_returns_default_not_exception():
    field = EncryptedJSON(default_empty=list)
    # Şifrelenmemiş/bozuk bir değer verilirse çökmemeli, boş listeye düşmeli.
    assert field.process_result_value("bu-gecerli-bir-fernet-tokeni-degil", None) == []
