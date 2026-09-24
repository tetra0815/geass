import re

from conftest import PLUGIN_ROOT

SKILL = (PLUGIN_ROOT / "skills" / "rdra" / "SKILL.md").read_text()
MCP = (PLUGIN_ROOT / "rdra-server" / "src" / "mcp.ts").read_text()
CLI = (PLUGIN_ROOT / "rdra-server" / "src" / "cli.ts").read_text()


def test_skill_documents_exactly_the_registered_tools() -> None:
    registered = set(re.findall(r'registerTool\(\s*"(rdra_[a-z_]+)"', MCP))
    documented = set(re.findall(r"\b(rdra_[a-z_]+)\b", SKILL))
    assert registered, "no tools found in mcp.ts"
    assert documented == registered


def test_skill_offers_no_way_to_approve() -> None:
    assert not re.search(r"registerTool\(\s*\"rdra_(approve|reject|decide)", MCP)


def test_skill_uses_existing_cli_commands() -> None:
    for command in re.findall(r"cli\.js\" ([a-z-]+)", SKILL):
        assert f'command === "{command}"' in CLI
