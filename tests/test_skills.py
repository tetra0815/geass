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


def test_rdra_skill_hands_off_to_design() -> None:
    text = skill_text("rdra")
    step7 = text[text.index("### Step 7"):]
    assert "1. **Design** — `/design`" in step7


def test_trace_skill_explains_design_elements() -> None:
    text = skill_text("trace")
    for needle in ["tbl.", "comp.", "removed", "/design"]:
        assert needle in text, needle


def test_templates_point_back_to_the_design_model() -> None:
    text = (PLUGIN_ROOT / "templates" / "README.md").read_text()
    for needle in ["/design", "doc", "comp.", "tbl.", "adr."]:
        assert needle in text, needle


def test_trace_skill_runs_the_cli() -> None:
    assert 'cli.js" trace --repo' in skill_text("trace")


def test_design_skill_covers_the_design_stage() -> None:
    text = skill_text("design")
    for needle in [
        'stage: "design"',
        "designFeatureIssues",
        'cli.js" wait-review --stage design',
        "docs/design",
        "holds",
        "superseded",
        "/rdra",
        "required",
        "Covers:",
        "/trace",
    ]:
        assert needle in text, needle


def test_design_skill_uses_only_registered_tools() -> None:
    registered = set(re.findall(r'registerTool\(\s*"(rdra_[a-z_]+)"', MCP))
    used = set(re.findall(r"\b(rdra_[a-z_]+)\b", skill_text("design")))
    assert used, "the design skill names no tools"
    assert used <= registered, used - registered


REMOVED_COMMAND = re.compile(
    r"(?<![\w/.-])/(specify|plan|tasks|analyze|checklist|converge|constitution|implement|taskstoissues|design-spec)\b(?![-.\w])"
)
LEGACY = ["SPECIFY_FEATURE_DIRECTORY", "check-prerequisites", "scripts/bash", "feature.json", "geass-base-commit", "rdra-review.json", "extensions.yml", "spec-kit", "speckit"]


def shipped_files() -> list:
    files = [PLUGIN_ROOT / "README.md", *sorted((PLUGIN_ROOT / ".claude-plugin").glob("*.json"))]
    for folder in ["skills", "hooks", "scripts", "templates"]:
        files += sorted(p for p in (PLUGIN_ROOT / folder).rglob("*") if p.is_file() and "__pycache__" not in p.parts)
    return files


def test_only_the_rdra_centric_skills_remain() -> None:
    assert sorted(p.name for p in SKILLS.iterdir() if p.is_dir()) == ["design", "feature-start", "fix-start", "rdra", "trace"]


def test_spec_kit_files_are_gone() -> None:
    assert not (PLUGIN_ROOT / "scripts" / "bash").exists()
    for name in ["spec", "plan", "tasks", "checklist", "constitution"]:
        assert not (PLUGIN_ROOT / "templates" / f"{name}-template.md").exists()


def test_nothing_shipped_refers_to_the_removed_pipeline() -> None:
    for path in shipped_files():
        text = path.read_text()
        match = REMOVED_COMMAND.search(text)
        assert not match, (str(path.relative_to(PLUGIN_ROOT)), match.group(0))
        for word in LEGACY:
            assert word not in text, (str(path.relative_to(PLUGIN_ROOT)), word)
