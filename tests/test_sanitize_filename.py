import pytest
from downloader import sanitize_filename

def test_sanitize_normal_filename():
    assert sanitize_filename("archive.zip") == "archive.zip"
    assert sanitize_filename("document-v1.0.pdf") == "document-v1.0.pdf"

def test_sanitize_invalid_characters():
    assert sanitize_filename('file:name*with?bad"chars<>.txt') == "file_name_with_bad_chars__.txt"
    assert sanitize_filename(r"path\to/file|test.bin") == "path_to_file_test.bin"

def test_sanitize_windows_reserved_names():
    assert sanitize_filename("CON.txt") == "_CON.txt"
    assert sanitize_filename("aux.zip") == "_aux.zip"
    assert sanitize_filename("nul") == "_nul"
    assert sanitize_filename("prn.tar.gz") == "_prn.tar.gz"
    assert sanitize_filename("com1.dat") == "_com1.dat"
    assert sanitize_filename("lpt1.log") == "_lpt1.log"

def test_sanitize_empty_and_spaces():
    assert sanitize_filename("") == "download"
    assert sanitize_filename("   ") == "download"
    assert sanitize_filename("...") == "download"
    assert sanitize_filename(None) == "download"

def test_sanitize_length_limit():
    long_name = "a" * 200 + ".mp4"
    sanitized = sanitize_filename(long_name)
    assert len(sanitized) <= 150
    assert sanitized.endswith(".mp4")
