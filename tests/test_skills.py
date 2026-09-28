import re
from pathlib import Path

from conftest import PLUGIN_ROOT

SKILLS = PLUGIN_ROOT / "skills"
MCP = (PLUGIN_ROOT / "rdra-server" / "src" / "mcp.ts").read_text()
CLI = (PLUGIN_ROOT / "rdra-server" / "src" / "cli.ts").read_text()


def skill_text(name: str) -> str:
    return (SKILLS / name / "SKILL.md").read_text()


def test_rdra_skill_documents_exactly_the_registered_tools() -> None:
    registered = set(re.findall(r'registerTool\(\s*"(rdra_[a-z_]+)"', MCP))
    documented = set(re.findall(r"\b(rdra_[a-z_]+)\b", skill_text("rdra")))
    assert registered, "no tools found in mcp.ts"
    assert documented == registered


def test_there_is_no_tool_to_approve() -> None:
    assert not re.search(r"registerTool\(\s*\"rdra_(approve|reject|decide)", MCP)


def test_skills_use_existing_cli_commands_and_flags() -> None:
    for path in SKILLS.glob("*/SKILL.md"):
        text = path.read_text()
        for command in re.findall(r'cli\.js" ([a-z-]+)', text):
            assert f'command === "{command}"' in CLI, (path.name, command)
        assert "--feature-dir" not in text, path


def test_rdra_skill_covers_principles_acceptance_and_migration() -> None:
    text = skill_text("rdra")
    for needle in ["principles", "acceptance", "pr.scope", ".geass/memory/constitution.md", "Covers:", "/trace", "featureIssues"]:
        assert needle in text, needle


def test_trace_skill_runs_the_cli() -> None:
    assert 'cli.js" trace --repo' in skill_text("trace")
