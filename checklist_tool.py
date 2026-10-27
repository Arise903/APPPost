#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
上架前 App 配置清单 —— 后端服务与构建工具

设计要点
  1. md 是唯一真相源（``上架前App配置清单.md``）。所有勾选状态最终写回 md 文件本身。
  2. 看板（浏览器 UI）通过本地 HTTP 服务读写 md，用户全程只用界面控件，不碰命令行。
  3. 破坏性操作（清空完成状态 / 覆盖写回）必须二次确认，且服务端自动备份。

命令
  serve     启动本地看板服务并打开浏览器（日常使用入口）
  build     由模板重新生成静态看板（离线兜底用）
  status    命令行查看进度（排查用）
  reset     命令行清空完成状态（应急用，日常请用界面按钮）
  all       reset + build
  open      用系统浏览器打开静态看板

用法
  python3 checklist_tool.py serve            # 启动（推荐）
  python3 checklist_tool.py serve --port 8899 --no-browser
"""

from storage_utils import atomic_write, revision, load_review, save_review
import logging
import permission_visibility
import argparse
import datetime
import html as html_mod
import json
import os
import platform
import re
import shutil
import socket
import subprocess
import sys
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

HERE = Path(__file__).resolve().parent
DEFAULT_MD = HERE / "上架前App配置清单.md"
DEFAULT_HTML = HERE / "上架前App配置清单.html"
TEMPLATE = HERE / "board_template.html"
STATE_FILE = HERE / ".checklist_generation.json"
PERM_FILE = HERE / "permission_profiles.json"
EN_DOC_FILE = HERE / "Privacy-and-Permissions-EN.md"

APPENDIX_HEADING = "附录：权限与隐私配置"
APPENDIX_END = "<!-- PERMISSION_APPENDIX_END -->"
APPENDIX_MARK = "<!-- PERMISSION_APPENDIX -->"
EN_DOC_MARK = "<!-- PERMISSION_APPENDIX_EN -->"

RE_FENCE = re.compile(r"^\s*```")
RE_H1 = re.compile(r"^#\s+(.*)$")
RE_H2 = re.compile(r"^##\s+(.*)$")
RE_H3 = re.compile(r"^###\s+(.*)$")
RE_H4 = re.compile(r"^####\s+(.*)$")
RE_ITEM = re.compile(r"^(\s*)[-*]\s+(\[[ xX\-]\])\s*(.*)$")
RE_BULLET = re.compile(r"^(\s*)[-*]\s+(.*)$")
RE_ORDER = re.compile(r"^(\s*)(\d+)[.)]\s+(.*)$")
RE_QUOTE = re.compile(r"^>\s?(.*)$")
RE_HR = re.compile(r"^\s*-{3,}\s*$")
RE_TABLE_SEP = re.compile(r"^\s*\|[\s:|-]+\|\s*$")
RE_COMMENT = re.compile(r"^\s*<!--\s*([A-Za-z0-9_-]+)\s*-->\s*$")
# 项目特征配置：<!-- FEATURES hasAccountSystem=1 targetMinors=0 -->
RE_FEATURES = re.compile(r"<!--\s*FEATURES\s+(.*?)-->", re.S)
RE_FEATURE_KV = re.compile(r"([A-Za-z0-9_]+)\s*=\s*([01])")
# 条目行尾的条件标记：<!-- if:hasAccountSystem -->
RE_ITEM_COND = re.compile(r"\s*<!--\s*if:([A-Za-z0-9_]+)\s*-->\s*$")


# --------------------------------------------------------------------------- #
# 解析
# --------------------------------------------------------------------------- #

def inline_html(text: str) -> str:
    s = html_mod.escape(text, quote=False)
    s = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    s = re.sub(r"~~(.+?)~~", r"<del>\1</del>", s)
    return s


def _fnv1a(s: str) -> int:
    """32 位 FNV-1a。纯整数运算，Python / JS 结果完全一致。"""
    h = 0x811C9DC5
    for b in s.encode("utf-8"):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def _make_id(path_parts, text, counter) -> str:
    key = " / ".join(path_parts) + "\x00" + text
    counter[key] = counter.get(key, 0) + 1
    digest = _fnv1a(key + "\x00" + str(counter[key]))
    return "t_%08x" % digest


def parse_md(text: str) -> dict:
    """解析清单 markdown。

    返回结构：
      title / preamble / sections / items
    每个 item 带 ``line``（源文件行号，0 基）与 ``span``（该行内 ``[ ]`` 标记的
    起止下标），用于精确写回而不破坏其他格式。
    """
    lines = text.split("\n")

    title = "Checklist"
    preamble = []
    sections = []
    items = []
    cur_section = None
    counter = {}
    path = []

    # 项目特征（决定哪些条目显示）
    features = {"hasAccountSystem": True, "targetMinors": True, "hasFeedbackSystem": False}
    fm = RE_FEATURES.search(text)
    if fm:
        for k, v in RE_FEATURE_KV.findall(fm.group(1)):
            features[k] = (v == "1")

    in_fence = False
    fence_lang = ""
    fence_lines = []
    fence_start = 0
    pending_flags = []          # 累积的 HTML 注释标记，作用于下一个 section
    i = 0

    def target_blocks():
        return cur_section["blocks"] if cur_section is not None else preamble

    while i < len(lines):
        raw = lines[i]
        stripped = raw.strip()

        if RE_FENCE.match(raw):
            if in_fence:
                target_blocks().append(
                    {"type": "code", "lang": fence_lang, "lines": list(fence_lines)}
                )
                in_fence = False
                fence_lang = ""
                fence_lines = []
            else:
                in_fence = True
                fence_lang = stripped[3:].strip()
                fence_lines = []
                fence_start = i
            i += 1
            continue
        if in_fence:
            fence_lines.append(raw)
            i += 1
            continue

        if not stripped:
            i += 1
            continue
        if RE_HR.match(raw):
            i += 1
            continue

        # 项目特征配置行：单独识别，不能落进 preamble
        if RE_FEATURES.search(raw):
            i += 1
            continue

        # HTML 注释标记：作用于它所在的 section
        mc = RE_COMMENT.match(raw)
        if mc:
            flag = mc.group(1).upper()
            if cur_section is not None:
                if flag == "COLLAPSE":
                    cur_section["collapsible"] = True
                elif flag == "GATE":
                    cur_section["is_gate"] = True
                elif flag == "GUIDE":
                    # 只作《使用说明》页面的内容源，不在看板首页渲染
                    cur_section["guide_only"] = True
            else:
                pending_flags.append(flag)
            i += 1
            continue

        # 表格
        if stripped.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                row_line = lines[i].strip()
                if not RE_TABLE_SEP.match(row_line):
                    rows.append([c.strip() for c in row_line.strip("|").split("|")])
                i += 1
            if rows:
                target_blocks().append({"type": "table", "rows": rows})
            continue

        m = RE_H1.match(raw)
        if m:
            title = m.group(1).strip()
            path = [title]
            i += 1
            continue

        m = RE_H2.match(raw)
        if m:
            name = m.group(1).strip()
            sid = "s_%08x" % _fnv1a(name)
            cur_section = {
                "title": name,
                "id": sid,
                "blocks": [],
                "collapsible": "COLLAPSE" in pending_flags,
            }
            sections.append(cur_section)
            pending_flags = []
            path = [title, name]
            i += 1
            continue

        m = RE_H3.match(raw)
        if m:
            name = m.group(1).strip()
            target_blocks().append({"type": "h3", "title": name})
            path = path + [name]
            i += 1
            continue

        m = RE_H4.match(raw)
        if m:
            name = m.group(1).strip()
            target_blocks().append({"type": "h4", "title": name})
            path = path + [name]
            i += 1
            continue

        m = RE_ITEM.match(raw)
        if m:
            indent, marker, body = m.group(1), m.group(2), m.group(3)
            level = len(indent.replace("\t", "  ")) // 2
            start = m.start(2)
            end = m.end(2)
            mark = marker[1]
            if mark in "xX":
                st = "done"
            elif mark == "-":
                st = "skip"
            else:
                st = "todo"
            # 行尾条件标记：<!-- if:hasAccountSystem -->
            cond = None
            cm = RE_ITEM_COND.search(body)
            if cm:
                cond = cm.group(1)
                body = body[: cm.start()].rstrip()
            item = {
                "type": "item",
                "id": _make_id(path, body.strip(), counter),
                "level": level,
                "state": st,
                "checked": st == "done",
                "text": body.strip(),
                "line": i,
                "span": [start, end],
                "cond": cond,
            }
            items.append(item)
            target_blocks().append(item)
            i += 1
            continue

        m = RE_BULLET.match(raw)
        if m:
            indent, body = m.group(1), m.group(2)
            level = len(indent.replace("\t", "  ")) // 2
            target_blocks().append({"type": "bullet", "level": level, "text": body.strip()})
            i += 1
            continue

        m = RE_ORDER.match(raw)
        if m:
            indent, num, body = m.group(1), int(m.group(2)), m.group(3)
            level = len(indent.replace("\t", "  ")) // 2
            target_blocks().append(
                {"type": "ordered", "level": level, "num": num, "text": body.strip()}
            )
            i += 1
            continue

        m = RE_QUOTE.match(raw)
        if m:
            body = m.group(1).strip()
            if body:
                target_blocks().append({"type": "note", "text": body})
            i += 1
            continue

        target_blocks().append({"type": "para", "text": stripped})
        i += 1

    if in_fence and fence_lines:
        target_blocks().append({"type": "code", "lang": fence_lang, "lines": list(fence_lines)})

    return {
        "title": title,
        "preamble": preamble,
        "sections": sections,
        "items": items,
        "features": features,
    }


# --------------------------------------------------------------------------- #
# 权限 / 隐私配置
# --------------------------------------------------------------------------- #

def load_profiles() -> dict:
    if not PERM_FILE.exists():
        return {"scenarios": [], "permissions": [], "groups": [], "appstore_data_types": []}
    return json.loads(PERM_FILE.read_text(encoding="utf-8"))


def _perm_by_id(profiles: dict) -> dict:
    return {p["id"]: p for p in profiles.get("permissions", [])}


def _ios_keys(p: dict):
    """统一取出该权限的 iOS Info.plist 键列表（含中英文默认文案）。"""
    ios = p.get("ios") or {}
    if ios.get("infoplist_keys"):
        return ios["infoplist_keys"]
    if ios.get("infoplist_key"):
        return [{
            "key": ios["infoplist_key"],
            "desc": ios.get("desc") or "",
            "desc_en": ios.get("desc_en") or "",
        }]
    return []


def _label_cn(profiles: dict, en_label: str) -> str:
    """把 App Store 的英文数据类型标签翻成中文（清单是中文的）。"""
    for t in profiles.get("appstore_data_types", []):
        if t.get("en") == en_label:
            return t.get("name", en_label)
    return en_label


def _desc_for(pid: str, lang: str, descs: dict, descs_en: dict, cn_default: str, en_default: str) -> str:
    """按语言取用途描述文案。

    优先级：当前语言下用户自定义 > 当前语言的内置默认 > 另一语言的用户自定义 > 另一语言的内置默认。
    这样切语言时，未被改过的项自动换成对应语言的默认文案；
    被改过的项保留用户写法（不会因为切换语言丢失）。
    """
    if lang == "en":
        custom, builtin = descs_en.get(pid), en_default
        alt_custom, alt_builtin = descs.get(pid), cn_default
    else:
        custom, builtin = descs.get(pid), cn_default
        alt_custom, alt_builtin = descs_en.get(pid), en_default
    if custom is not None and custom != "":
        return custom
    if builtin:
        return builtin
    if alt_custom:
        return alt_custom
    return alt_builtin or ""


def generate_config(profiles: dict, selected: list, descs: dict, descs_en: dict = None,
                    lang: str = "zh") -> dict:
    """根据选中的权限生成全套配套配置。

    selected: 权限 id 列表
    descs:    {perm_id: 中文用途描述}（用户自定义，可选）
    descs_en: {perm_id: 英文用途描述}（用户自定义，可选）
    lang:     "zh" 或 "en"，决定使用哪种语言的默认文案
    返回 {iosPlist, androidManifest, appstore, privacyPolicy, checks, missing}
    """
    descs = descs or {}
    descs_en = descs_en or {}
    pm = _perm_by_id(profiles)
    picked = [pm[i] for i in selected if i in pm]

    ios_lines = []
    android_lines = []
    appstore = []
    policy = []
    checks = []
    missing = []

    for p in picked:
        pid = p["id"]
        ios = p.get("ios") or {}
        and_ = p.get("android") or {}

        # --- iOS Info.plist ---
        keys = _ios_keys(p)
        if keys:
            for k in keys:
                desc = _desc_for(
                    pid, lang, descs, descs_en,
                    cn_default=k.get("desc") or "",
                    en_default=k.get("desc_en") or "",
                )
                if not desc.strip():
                    missing.append(f"{p['name']}：缺少 iOS 用途描述（{k['key']}）")
                ios_lines.append(f"<key>{html_mod.escape(k['key'])}</key>\n<string>{html_mod.escape(desc)}</string>")
        elif ios.get("note"):
            checks.append(f"〔{p['name']}〕{ios['note']}")

        # --- Android Manifest ---
        if and_.get("manifest"):
            desc = _desc_for(
                pid, lang, descs, descs_en,
                cn_default=and_.get("desc") or "",
                en_default=and_.get("desc_en") or "",
            )
            android_lines.append(f'<uses-permission android:name="{and_["manifest"]}" />')
            if and_.get("runtime"):
                checks.append(
                    f"〔{p['name']}〕Android 为运行时权限，需在 Activity 中动态申请"
                    + (f"；{and_['manifest_note']}" if and_.get("manifest_note") else "")
                )
            else:
                checks.append(f"〔{p['name']}〕Android 为普通权限，安装时自动授予")
        elif and_.get("manifest_note"):
            checks.append(f"〔{p['name']}〕{and_['manifest_note']}")

        # --- App Store 隐私问卷（中英对照） ---
        for label in ios.get("appstore_labels") or []:
            cn = _label_cn(profiles, label)
            entry = f"{cn}（{label}）"
            if entry not in appstore:
                appstore.append(entry)

        # --- 隐私政策段落（按语言切换） ---
        pname = p["name_en"] if lang == "en" and p.get("name_en") else p["name"]
        ptext = p.get("policy_text_en") if lang == "en" else p.get("policy_text")
        if not ptext and lang == "en":
            ptext = p.get("policy_text")
        if ptext:
            policy.append(f"- **{pname}**：{ptext}")

        # --- 审核注意事项（按语言切换） ---
        notes = p.get("review_notes_en") if lang == "en" else p.get("review_notes")
        if not notes and lang == "en":
            notes = p.get("review_notes")
        for n in notes or []:
            # 用「」而非 []，避免被 markdown 解析成任务项混入清单编号
            checks.append(f"〔{pname}〕{n}")

    return {
        "iosPlist": "\n".join(ios_lines),
        "androidManifest": "\n".join(android_lines),
        "appstore": appstore,
        "privacyPolicy": "\n".join(policy),
        "checks": checks,
        "missing": missing,
    }


def build_english_appendix(profiles: dict, selected: list, descs_en: dict = None) -> str:
    """English explanations embedded beside the Chinese permission appendix."""
    descs_en = descs_en or {}
    pm = _perm_by_id(profiles)
    cfg = generate_config(profiles, selected, {}, descs_en, lang="en")
    out = ["### 英文权限用途说明（English Permission Descriptions）", ""]
    for pid in selected:
        permission = pm.get(pid)
        if not permission:
            continue
        descriptions = [k.get("desc_en", "") for k in _ios_keys(permission)]
        description = (descs_en.get(pid) or " ".join(dict.fromkeys(d for d in descriptions if d))
                       or (permission.get("android") or {}).get("desc_en")
                       or permission.get("policy_text_en") or "Please provide an English description of this permission's purpose.")
        out.append(f"- **{permission.get('name_en') or pid}**: {description}")
    out.extend(["", "### iOS Info.plist（English）", "", "```xml", "<dict>",
                cfg["iosPlist"] or "    <!-- No permission usage descriptions required -->", "</dict>", "```", "",
                "### 英文隐私政策文案（Privacy Policy Copy）", "",
                cfg["privacyPolicy"] or "_No permission-specific privacy policy copy configured._", ""])
    return "\n".join(out)


def build_appendix(profiles: dict, selected: list, descs: dict, descs_en: dict = None) -> str:
    """生成 md 附录（权限与隐私配置）。"""
    pm = _perm_by_id(profiles)
    cfg = generate_config(profiles, selected, descs, descs_en, lang="zh")
    groups = {g["id"]: g["name"] for g in profiles.get("groups", [])}

    out = [APPENDIX_MARK, f"## {APPENDIX_HEADING}", ""]
    out.append("> 本附录由看板的「权限与隐私配置」面板自动生成，请勿手工编辑。")
    out.append("> 勾选 App 实际使用的权限，工具会同步生成 Info.plist、Manifest、隐私问卷与政策段落。")
    out.append("")

    if not selected:
        out.append("_尚未配置任何权限。_")
        out.append("")
        return "\n".join(out)

    out.append(f"已配置 **{len(selected)}** 项权限。")
    out.append("")

    # 权限清单
    out.append("### 权限清单")
    out.append("")
    out.append("| 权限 | iOS | Android | 运行时申请 |")
    out.append("| --- | --- | --- | --- |")
    for pid in selected:
        p = pm.get(pid)
        if not p:
            continue
        keys = _ios_keys(p)
        ios_txt = "<br>".join(f"`{k['key']}`" for k in keys) if keys else "无需声明"
        and_ = p.get("android") or {}
        and_txt = f"`{and_['manifest']}`" if and_.get("manifest") else "无需声明"
        rt = "是" if and_.get("runtime") else "否"
        out.append(f"| {p['name']} | {ios_txt} | {and_txt} | {rt} |")
    out.append("")

    # iOS Info.plist
    out.append("### iOS Info.plist")
    out.append("")
    out.append("```xml")
    out.append("<dict>")
    out.append(cfg["iosPlist"] if cfg["iosPlist"] else "    <!-- 无需添加权限声明 -->")
    out.append("</dict>")
    out.append("```")
    out.append("")

    # Android Manifest
    out.append("### AndroidManifest.xml")
    out.append("")
    out.append("```xml")
    out.append(cfg["androidManifest"] if cfg["androidManifest"] else "<!-- 无需添加权限声明 -->")
    out.append("```")
    out.append("")

    # App Store 隐私问卷
    out.append("### App Store Connect 隐私问卷")
    out.append("")
    if cfg["appstore"]:
        out.append("在「App 隐私」中选择以下数据类型：")
        out.append("")
        for label in cfg["appstore"]:
            # 用普通 bullet 而非 [ ]，避免附录条目混入清单的顺序编号
            out.append(f"- {label}")
    else:
        out.append("_未选择任何数据类型（若 App 仅使用 localStorage 缓存，可选择「不收集数据」）。_")
    out.append("")

    # 隐私政策段落
    out.append("### 隐私政策必备段落")
    out.append("")
    if cfg["privacyPolicy"]:
        out.append("以下段落需合并进隐私政策的「我们收集哪些信息」章节：")
        out.append("")
        out.append(cfg["privacyPolicy"])
    else:
        out.append("_当前选中的权限无需在隐私政策中单独说明。_")
    out.append("")

    out.append(build_english_appendix(profiles, selected, descs_en))
    out.append("")

    # 审核要点
    out.append("### 审核要点")
    out.append("")
    if cfg["checks"]:
        for c in cfg["checks"]:
            out.append(f"- {c}")
    else:
        out.append("_无_")
    out.append("")

    # 缺失提醒
    if cfg["missing"]:
        out.append("### ⚠️ 待补充")
        out.append("")
        for m in cfg["missing"]:
            out.append(f"- {m}")
        out.append("")

    return "\n".join(out)


def write_appendix(md_path: Path, selected: list, descs: dict, descs_en: dict = None) -> str:
    """把附录写回 md（替换旧附录，没有则追加到末尾）。"""
    profiles = load_profiles()
    appendix = build_appendix(profiles, selected, descs, descs_en)
    text = md_path.read_text(encoding="utf-8")

    if APPENDIX_MARK in text:
        start = text.index(APPENDIX_MARK)
        end = text.find(APPENDIX_END, start)
        if end >= 0:
            tail = text[end + len(APPENDIX_END):]
        else:
            # 旧格式没有结束标记：保留后续用户二级章节。
            match = re.search(r"^## (?!附录：权限与隐私配置).+", text[start:], re.M)
            tail = "\n\n" + text[start + match.start():] if match else ""
        new_text = text[:start] + appendix.rstrip() + "\n" + APPENDIX_END + tail
    else:
        new_text = text.rstrip("\n") + "\n\n---\n\n" + appendix.rstrip() + "\n" + APPENDIX_END + "\n"
    atomic_write(md_path, new_text)
    # 同步保存面板状态（选中项 + 中英文描述），下次打开面板时原样回填
    write_perm_state(md_path, selected, descs, descs_en)
    return appendix


def write_features(md_path: Path, features: dict) -> bool:
    """把项目特征写回 md 的 FEATURES 注释行。返回是否发生变更。"""
    text = md_path.read_text(encoding="utf-8")
    parts = []
    for k in ("hasAccountSystem", "targetMinors", "hasFeedbackSystem"):
        parts.append(f"{k}={1 if features.get(k) else 0}")
    line = "<!-- FEATURES " + " ".join(parts) + " -->"

    m = RE_FEATURES.search(text)
    if m:
        if m.group(0).strip() == line:
            return False
        new_text = text[: m.start()] + line + text[m.end():]
    else:
        # 插到一级标题之后
        lines = text.split("\n")
        ins = 1
        for i, l in enumerate(lines):
            if l.startswith("# "):
                ins = i + 1
                break
        lines.insert(ins, "")
        lines.insert(ins + 1, line)
        new_text = "\n".join(lines)
    backup_md(md_path)
    atomic_write(md_path, new_text, encoding="utf-8")
    return True


def find_gate_item(parsed: dict):
    """返回门禁章节里的确认条目（没有则返回 None）。"""
    for sec in parsed.get("sections", []):
        if sec.get("is_gate") or "确认已了解使用说明" in sec.get("title", ""):
            for b in sec["blocks"]:
                if b.get("type") == "item":
                    return b
    return None


def set_gate(md_path: Path, done: bool = True) -> bool:
    """把门禁确认项标记写回 md。返回是否发生变更。

    三态语义：
      [ ]  从未确认过（初始态）
      [x]  已确认
      [-]  明确拒绝过（用户主动点了「取消确认」）

    区分「从未确认」与「明确拒绝」很重要：只有前者才允许从本机
    localStorage 自动补写，否则用户取消过的确认会被悄悄复活。
    """
    text = md_path.read_text(encoding="utf-8")
    parsed = parse_md(text)
    item = find_gate_item(parsed)
    if item is None:
        return False
    target = "done" if done else "skip"
    if item["state"] == target:
        return False
    new_text = apply_states(text, parsed, {item["id"]: target})
    backup_md(md_path)
    atomic_write(md_path, new_text, encoding="utf-8")
    return True


def perm_state_file(md_path: Path) -> Path:
    """权限面板状态文件（选中项 + 中英文用途描述），与清单 md 同目录。"""
    return md_path.with_name("." + md_path.stem + ".permstate.json")


def write_perm_state(md_path: Path, selected: list, descs: dict, descs_en: dict = None):
    """把权限面板的完整状态落盘，供再次打开面板时回填。"""
    atomic_write(perm_state_file(md_path), 
        json.dumps({
            "selected": list(selected or []),
            "descs": dict(descs or {}),
            "descsEn": dict(descs_en or {}),
        }, ensure_ascii=False, indent=1),
        encoding="utf-8",
    )


def read_perm_state(md_path: Path):
    """读取权限面板状态。状态文件缺失时退回从 md 附录反解选中项。"""
    try:
        d = json.loads(perm_state_file(md_path).read_text(encoding="utf-8"))
        return (
            list(d.get("selected") or []),
            dict(d.get("descs") or {}),
            dict(d.get("descsEn") or {}),
        )
    except Exception:
        return read_appendix_selection(md_path), {}, {}


def read_appendix_selection(md_path: Path) -> list:
    """从 md 附录反解出已配置的权限 id（用于静态看板离线预填）。"""
    try:
        text = md_path.read_text(encoding="utf-8")
    except Exception:
        return []
    if APPENDIX_MARK not in text:
        return []
    profiles = load_profiles()
    pm = _perm_by_id(profiles)
    tail = text.split(APPENDIX_MARK, 1)[1]
    found = []
    for line in tail.split("\n"):
        if not line.startswith("| "):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if not cells or cells[0] in ("权限", "---"):
            continue
        for pid, p in pm.items():
            if p["name"] == cells[0] and pid not in found:
                found.append(pid)
    return found


# --------------------------------------------------------------------------- #
# 通用英文隐私政策与权限说明文档
# --------------------------------------------------------------------------- #

EN_SECTION_TITLES = {
    "camera": "Camera",
    "photos": "Photo Library",
    "microphone": "Microphone",
    "location_foreground": "Location (While Using the App)",
    "location_background": "Location (In the Background)",
    "notifications": "Notifications",
    "health": "Health Data",
    "motion": "Motion Sensors",
    "contacts": "Contacts",
    "tracking": "Cross-App Tracking",
    "network": "Network Access",
    "storage": "File Access",
    "bluetooth": "Bluetooth",
}

EN_WHEN_REQUESTED = {
    "camera": "requested only when you tap the scan button.",
    "photos": "requested only when you choose to import a photo.",
    "microphone": "requested only when you tap record.",
    "location_foreground": "requested only when you turn on distance sorting.",
    "location_background": "requested only when you start a background workout recording.",
    "notifications": "requested only after you opt in to reminders.",
    "health": "requested only when you link your health data.",
    "motion": "requested only when you enable the shake gesture.",
    "contacts": "requested only when you use the invite friends feature.",
    "tracking": "requested only after you choose to allow advertising measurement.",
    "network": "required for the App to work and is granted by the system.",
    "storage": "requested only when you import a card image from device storage.",
    "bluetooth": "requested only when you start a device sync.",
}

EN_ANDROID_RATIONALE = {
    "camera": "Allow [APP NAME] to take photos of cards so it can identify them?",
    "photos": "Allow [APP NAME] to access the photos you choose to import?",
    "microphone": "Allow [APP NAME] to record a voice note?",
    "location_foreground": "Allow [APP NAME] to use your location to sort nearby shops by distance?",
    "location_background": "Allow [APP NAME] to keep recording your route in the background while a workout is in progress?",
    "notifications": "Allow [APP NAME] to send you collection updates and event reminders?",
    "health": "Allow [APP NAME] to read your workout records to calculate collection progress?",
    "motion": "Allow [APP NAME] to detect shake gestures?",
    "contacts": "Allow [APP NAME] to access your contacts so you can invite friends?",
    "tracking": "Allow [APP NAME] to use your advertising ID to measure ad effectiveness?",
    "storage": "Allow [APP NAME] to read card images from device storage?",
    "bluetooth": "Allow [APP NAME] to connect to your Bluetooth devices?",
}

EN_PLAY_DATA_SAFETY = {
    "photos": ("Photos and videos", "Collected"),
    "microphone": ("Audio", "Collected"),
    "location_foreground": ("Location — Approximate", "Collected"),
    "location_background": ("Location — Precise", "Collected"),
    "health": ("Health and fitness", "Collected"),
    "motion": ("App activity / Other", "Collected"),
    "contacts": ("Contacts", "Collected"),
    "tracking": ("Device or other IDs", "Shared"),
    "notifications": ("App activity / Other", "Collected"),
    "network": ("App activity / Other", "Collected"),
    "storage": ("Photos and videos", "Collected"),
    "bluetooth": ("Device or other IDs", "Collected"),
}

EN_GENERIC_POLICY = {
    "intro": (
        '[APP NAME] ("the App", "we", "us") is provided by [COMPANY NAME] ("we", "us", "our"). '
        "This Privacy Policy explains what information we collect through the App, how we use it, "
        "and the choices available to you. The App is provided on Apple App Store and Google Play."
    ),
    "collect_intro": (
        "We collect only the information described below. We do not sell your personal information, "
        "and we do not share it with third parties for their own marketing purposes."
    ),
    "use_intro": "We use the information we collect for the following purposes:",
    "use_list": [
        "To provide and maintain the App's core features, including the features listed in the Permissions section below.",
        "To synchronise your data across your devices and to back up your data so you do not lose it.",
        "To respond to your support requests and to communicate with you about the App.",
        "To detect, prevent and investigate fraud, abuse and security incidents.",
        "To analyse aggregate usage so we can improve the App's performance and reliability.",
    ],
    "retention": (
        "We retain personal data only for as long as necessary to provide the App's features and to meet legal obligations. "
        "Data that you delete within the App is removed from our servers within [30] days. "
        "Data that is stored locally on your device remains on your device until you delete it, "
        "unless you choose to sync it."
    ),
    "thirdparty": (
        "The App may include third-party SDKs that collect information to support features such as analytics and advertising. "
        "These SDKs are subject to their own privacy policies, and their use is governed by the consent you provide. "
        "The full list of third-party SDKs and the data they collect is maintained in our "
        "[Third-Party SDK List], which is linked from this page."
    ),
    "rights_intro": "Depending on where you live, you may have the following rights:",
    "rights_list": [
        "The right to access and obtain a copy of the personal data we hold about you.",
        "The right to request correction of inaccurate or incomplete personal data.",
        "The right to request deletion of your personal data.",
        "The right to request that we restrict or object to the processing of your personal data.",
        "The right to data portability, where applicable.",
        "The right to withdraw consent at any time, without affecting the lawfulness of processing carried out before withdrawal.",
        "The right not to be subject to a decision based solely on automated processing, where applicable.",
        "The right to complain to your local data protection authority.",
    ],
    "rights_howto": (
        "To exercise any of these rights, contact us at [EMAIL ADDRESS]. We will verify your request and respond "
        "within [30] days. You can also delete your account and your data directly from within the App at any time."
    ),
    "children": (
        "The App is not directed to children under the age of [13], or the minimum age required in your jurisdiction, "
        "and we do not knowingly collect personal information from children. If you are a parent or guardian and believe "
        "a child has provided us with personal information, please contact us at [EMAIL ADDRESS] and we will delete it promptly."
    ),
    "security": (
        "We use industry-standard encryption in transit and at rest to protect your personal data. "
        "No method of transmission or storage is completely secure, so we cannot guarantee absolute security."
    ),
    "changes": (
        "We may update this Privacy Policy from time to time. When we make a material change, we will notify you "
        "in the App or by email before the change takes effect. The date of the latest revision is shown at the top of this page."
    ),
}

EN_COLLECT_LIST = [
    "**Account and contact information** — if you create an account, we store the email address or "
    "sign-in identifier you provide, along with your display name.",
    "**Content you create** — cards, notes, photos and voice notes you add to your collection. "
    "This content is stored on your device and, if you enable sync, on our servers.",
    "**Usage and diagnostic information** — anonymous crash reports and interaction events used to "
    "keep the App stable. This data is not linked to your identity.",
    "**Identifiers** — a device identifier used to keep your collection in sync and to measure "
    "advertising effectiveness where you have permitted tracking.",
]

EN_CONSENT = {
    "title": "Welcome to [APP NAME]",
    "body": (
        "To provide you with [CORE FEATURE], we need permission to use your [PERMISSION]. "
        "You can change this at any time in Settings.\n\n"
        "We only use this data for [PURPOSE]. See our Privacy Policy for details."
    ),
    "buttons": ["Allow", "Not Now"],
    "denied": "[PERMISSION] is off, so [FEATURE] is unavailable. You can turn it on any time in Settings.",
    "att_body": (
        "Allow [APP NAME] to track your activity across other companies' apps and websites? "
        "Your data will only be used to measure advertising effectiveness. You can change this at any time."
    ),
    "att_buttons": ["Allow Tracking", "Do Not Allow"],
    "att_footer": "If you do not allow tracking, the App works exactly the same. Only advertising measurement is affected.",
}


def _ios_keys_en(p: dict):
    ios = p.get("ios") or {}
    if ios.get("infoplist_keys"):
        return ios["infoplist_keys"]
    if ios.get("infoplist_key"):
        return [{
            "key": ios["infoplist_key"],
            "desc_en": ios.get("desc_en") or "",
        }]
    return []


def build_english_doc(profiles: dict, selected: list, descs_en: dict = None) -> str:
    """生成通用英文隐私政策与权限说明文档（可直接提交/发布）。"""
    descs_en = descs_en or {}
    pm = _perm_by_id(profiles)
    picked = [pm[i] for i in selected if i in pm]
    has_tracking = any(p["id"] == "tracking" for p in picked)

    L = []
    A = L.append

    A("# Privacy Policy and Permissions Guide (English)")
    A("")
    A("> **How to use this document**")
    A("> 1. Replace every `[BRACKETED]` placeholder with your own information.")
    A("> 2. Delete any section that does not apply to your app.")
    A("> 3. The **Permissions** and **Consent Copy** sections are generated from the permissions you selected, "
      "so the policy and the app cannot drift apart.")
    A("> 4. Publish this as your privacy policy page, and link it from your App Store and Google Play listings.")
    A("")
    A(f"_Generated on {datetime.datetime.now().strftime('%Y-%m-%d')} · "
      f"{len(picked)} permission(s) configured_")
    A("")
    A("---")
    A("")

    # ---- Part 1 隐私政策正文 ----
    A("## Part 1 — Privacy Policy (ready to publish)")
    A("")
    A("**Last updated:** [DATE]")
    A("")
    A("### Introduction")
    A("")
    A(EN_GENERIC_POLICY["intro"])
    A("")
    A("### Information We Collect")
    A("")
    A(EN_GENERIC_POLICY["collect_intro"])
    A("")
    A("We collect the following categories of information:")
    A("")
    for line in EN_COLLECT_LIST:
        A(f"- {line}")
    A("")
    A("### How We Use Your Information")
    A("")
    A(EN_GENERIC_POLICY["use_intro"])
    A("")
    for x in EN_GENERIC_POLICY["use_list"]:
        A(f"- {x}")
    A("")
    A("### Data Retention")
    A("")
    A(EN_GENERIC_POLICY["retention"])
    A("")
    A("### Third-Party Services")
    A("")
    A(EN_GENERIC_POLICY["thirdparty"])
    A("")
    A("| SDK / Service | Purpose | Data collected |")
    A("| --- | --- | --- |")
    A("| [SDK NAME] | [PURPOSE] | [DATA TYPES] |")
    A("| [SDK NAME] | [PURPOSE] | [DATA TYPES] |")
    A("")
    A("### Your Privacy Rights")
    A("")
    A(EN_GENERIC_POLICY["rights_intro"])
    A("")
    for x in EN_GENERIC_POLICY["rights_list"]:
        A(f"- {x}")
    A("")
    A(EN_GENERIC_POLICY["rights_howto"])
    A("")
    A("### Children's Privacy")
    A("")
    A(EN_GENERIC_POLICY["children"])
    A("")
    A("### Security")
    A("")
    A(EN_GENERIC_POLICY["security"])
    A("")
    A("### Changes to This Policy")
    A("")
    A(EN_GENERIC_POLICY["changes"])
    A("")
    A("### Contact Us")
    A("")
    A("If you have any questions about this Privacy Policy or our data practices, contact us:")
    A("")
    for f in ("[COMPANY NAME]", "[ADDRESS]", "[EMAIL ADDRESS]", "[TELEPHONE, OPTIONAL]"):
        A(f"- {f}")
    A("")
    A("---")
    A("")

    # ---- Part 2 权限段落 ----
    A("## Part 2 — Permissions We Request and Why")
    A("")
    A("To provide the features described above, the App requests the following system permissions. "
      "Each permission is requested only at the moment you use the feature that needs it, and you can decline it "
      "without losing access to the rest of the App.")
    A("")
    for p in picked:
        title = EN_SECTION_TITLES.get(p["id"], p["id"])
        body = p.get("policy_text_en") or (
            f"{title} access is used to provide the features described in this policy. "
            "We use this data only for that purpose, and it is not used for any other purpose without your consent."
        )
        A(f"### {title}")
        A("")
        A(body)
        A("")
        A(f"This permission is {EN_WHEN_REQUESTED.get(p['id'], 'requested only when you use the related feature.')}")
        A("")

    # ---- Part 3 UsageDescription ----
    A("## Part 3 — Permission Request Strings")
    A("")
    A("### iOS — `Info.plist`")
    A("")
    A("Paste this into your `Info.plist`. Every key must have a purpose string that explains "
      "specifically how the app uses the feature — Apple rejects vague strings such as "
      '"This app needs camera access".')
    A("")
    A("```xml")
    A("<dict>")
    for p in picked:
        for k in _ios_keys_en(p):
            d = descs_en.get(p["id"]) or k.get("desc_en") or ""
            if not d.strip():
                d = "[DESCRIBE THE PURPOSE HERE]"
            A(f"<key>{k['key']}</key>")
            A(f"<string>{d}</string>")
    A("</dict>")
    A("```")
    A("")
    A("| Key | Purpose string |")
    A("| --- | --- |")
    for p in picked:
        for k in _ios_keys_en(p):
            d = descs_en.get(p["id"]) or k.get("desc_en") or "[DESCRIBE THE PURPOSE HERE]"
            A(f"| `{k['key']}` | {d} |")
    A("")
    A("### Android — `AndroidManifest.xml`")
    A("")
    A("```xml")
    for p in picked:
        m = (p.get("android") or {}).get("manifest")
        if m:
            A(f'<uses-permission android:name="{m}" />')
    A("```")
    A("")
    A("| Permission | Runtime request | Purpose string |")
    A("| --- | --- | --- |")
    for p in picked:
        a = p.get("android") or {}
        if not a.get("manifest"):
            continue
        d = descs_en.get(p["id"]) or a.get("desc_en") or ""
        A(f"| `{a['manifest']}` | {'Yes' if a.get('runtime') else 'No'} | {d} |")
    A("")

    # ---- Part 4 同意弹窗 ----
    A("## Part 4 — Consent and Permission Dialog Copy")
    A("")
    A("### First-launch consent (iOS and Android)")
    A("")
    A("```")
    A(EN_CONSENT["title"])
    A("")
    A(EN_CONSENT["body"])
    A("")
    A(f"[{EN_CONSENT['buttons'][0]}]        [{EN_CONSENT['buttons'][1]}]")
    A("```")
    A("")
    A("If the user declines, show this inline message and keep the rest of the app usable:")
    A("")
    A("```")
    A(EN_CONSENT["denied"])
    A("```")
    A("")
    if has_tracking:
        A("### App Tracking Transparency prompt (iOS)")
        A("")
        A("The system prompt text is fixed by Apple — you only control the `NSUserTrackingUsageDescription` "
          "shown above the prompt and the follow-up message below it.")
        A("")
        A("```")
        A(EN_CONSENT["att_body"])
        A("")
        A(f"[{EN_CONSENT['att_buttons'][0]}]        [{EN_CONSENT['att_buttons'][1]}]")
        A("")
        A(EN_CONSENT["att_footer"])
        A("```")
        A("")
    A("### Android runtime permission rationale")
    A("")
    A("Show this text immediately before the system permission dialog. The system dialog follows, "
      "so the user understands why before being asked.")
    A("")
    A("| Permission | Rationale to show |")
    A("| --- | --- |")
    for p in picked:
        r = EN_ANDROID_RATIONALE.get(p["id"])
        if r:
            A(f"| {EN_SECTION_TITLES.get(p['id'], p['id'])} | {r} |")
    A("")

    # ---- Part 5 App Store 问卷 ----
    A("## Part 5 — App Store Connect Privacy Nutrition Label")
    A("")
    A("Tick the following data types under **App Privacy**. These are derived from the permissions you selected, "
      "so they match what the app actually does.")
    A("")
    labels = []
    for p in picked:
        for lb in (p.get("ios") or {}).get("appstore_labels") or []:
            if lb not in labels:
                labels.append(lb)
    if labels:
        A("| Data type | Linked to user | Used for tracking | Purpose |")
        A("| --- | --- | --- | --- |")
        for lb in labels:
            tracking = "Yes" if lb in ("Tracking", "Advertising Data") else "No"
            linked = "Yes" if lb in ("Tracking", "Advertising Data", "Identifiers", "Health & Fitness", "Contacts") else "No"
            A(f"| {lb} | {linked} | {tracking} | [APP PURPOSE] |")
    else:
        A("_No data types are collected. Select **Data Not Collected** if that is accurate._")
    A("")

    # ---- Part 6 Google Play ----
    A("## Part 6 — Google Play Data Safety Form")
    A("")
    A("| Data type | Shared | Collected | Secure handling |")
    A("| --- | --- | --- | --- |")
    for p in picked:
        row = EN_PLAY_DATA_SAFETY.get(p["id"])
        if not row:
            continue
        A(f"| {row[0]} | {'Yes' if row[1] == 'Shared' else 'No'} | "
          f"{'Yes' if row[1] == 'Collected' else 'No'} | [ENCRYPTION IN TRANSIT / AT REST] |")
    A("")
    A("> Google Play requires the data safety form to match the app's actual behaviour. "
      "If a data type is only collected after an explicit user action, note that in the purpose field.")
    A("")

    # ---- Part 7 审核备注 ----
    A("## Part 7 — Review Notes")
    A("")
    A("Points reviewers commonly raise, per permission. Check these before submitting.")
    A("")
    for p in picked:
        notes = p.get("review_notes_en") or []
        if not notes:
            continue
        A(f"**{EN_SECTION_TITLES.get(p['id'], p['id'])}**")
        A("")
        for n in notes:
            A(f"- {n}")
        A("")

    # ---- Part 8 占位符清单 ----
    A("## Part 8 — Placeholders to Replace")
    A("")
    A("Search the document for `[` before publishing. Every placeholder below must be filled in.")
    A("")
    for x in sorted(set(re.findall(r"\[[A-Z][A-Z0-9 /\-\.]*\]", "\n".join(L)))):
        A(f"- [ ] `{x}`")
    A("")

    return "\n".join(L)


def write_english_doc(path: Path, selected: list, descs_en: dict = None) -> str:
    """生成英文文档到独立文件。"""
    profiles = load_profiles()
    doc = build_english_doc(profiles, selected, descs_en)
    atomic_write(path, doc, encoding="utf-8")
    return doc


# --------------------------------------------------------------------------- #
# 独立使用说明页面
# --------------------------------------------------------------------------- #

GUIDE_FILE = HERE / "使用说明.html"

GUIDE_CSS = """
  :root{
    --bg:#F7F7F5; --surface:#FFFFFF; --surface-2:#FBFBFA;
    --border:#E5E4E0; --border-2:#D3D1C7;
    --text:#2C2C2A; --text-2:#5F5E5A; --text-3:#888780;
    --accent:#185FA5; --accent-soft:#E6F1FB;
    --ok:#3B6D11; --ok-soft:#EAF3DE;
    --warn:#854F0B; --warn-soft:#FAEEDA;
    --danger:#A32D2D; --danger-soft:#FCEBEB;
    --radius:12px;
    --font:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
    --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
  }
  *{box-sizing:border-box}
  body{
    margin:0;background:var(--bg);color:var(--text);
    font-family:var(--font);font-size:15px;line-height:1.7;
    -webkit-font-smoothing:antialiased;
  }
  .wrap{max-width:760px;margin:0 auto;padding:40px 24px 120px}
  .hero{
    background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
    padding:30px 32px;margin-bottom:16px;
  }
  .hero h1{font-size:24px;font-weight:600;margin:0 0 8px;letter-spacing:-.01em}
  .hero p{margin:0;color:var(--text-2);font-size:14px}
  .hero .meta{margin-top:16px;padding-top:14px;border-top:1px solid var(--border);
    font-size:13px;color:var(--text-3);display:flex;gap:18px;flex-wrap:wrap}
  .card{
    background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
    padding:8px 32px 24px;margin-bottom:14px;
  }
  h2{font-size:16px;font-weight:600;margin:22px 0 10px;padding-top:12px;
     border-top:1px solid var(--border)}
  h2:first-child{border-top:0;margin-top:6px;padding-top:0}
  h3{font-size:13.5px;font-weight:600;margin:18px 0 8px;color:var(--text)}
  p{margin:8px 0;color:var(--text-2)}
  ul{list-style:none;margin:6px 0 10px;padding:0}
  ul li{color:var(--text-2);padding:3px 0 3px 20px;position:relative;font-size:14px}
  ul li::before{content:"";position:absolute;left:5px;top:12px;width:5px;height:5px;
    border-radius:50%;background:var(--border-2)}
  ul.bullets li.l1{padding-left:40px}
  ul.bullets li.l1::before{left:25px}
  ol{color:var(--text-2);padding-left:22px;margin:6px 0 10px;font-size:14px}
  ol li{padding:3px 0}
  strong{font-weight:600;color:var(--text)}
  code{font-family:var(--mono);font-size:.88em;background:#F1EFE8;padding:1px 5px;
    border-radius:4px;color:var(--accent)}
  pre{
    background:#2C2C2A;color:#E8E8E4;padding:16px 18px;border-radius:8px;
    overflow-x:auto;font-family:var(--mono);font-size:12.5px;line-height:1.65;margin:10px 0;
  }
  table{border-collapse:collapse;width:100%;margin:10px 0;font-size:13.5px}
  th,td{border:1px solid var(--border);padding:8px 11px;text-align:left;vertical-align:top}
  th{background:var(--surface-2);font-weight:600}
  tbody tr:nth-child(even){background:var(--surface-2)}
  .note{
    background:var(--surface-2);border-left:2.5px solid var(--border-2);border-radius:0 6px 6px 0;
    padding:9px 13px;margin:10px 0;font-size:13.5px;color:var(--text-2);
  }
  .note strong{color:var(--text)}
  .para{color:var(--text-2);font-size:14px;margin:8px 0}
  .ack{
    background:var(--surface);border:2px solid var(--accent);border-radius:var(--radius);
    padding:26px 28px;margin-top:22px;box-shadow:0 4px 20px rgba(24,95,165,.08);
  }
  .ack h2{border:0;margin:0 0 8px;padding:0;font-size:17px}
  .ack p{color:var(--text-2);font-size:14px;margin:0 0 16px}
  .acklabel{
    display:flex;gap:12px;align-items:flex-start;padding:14px 16px;background:var(--accent-soft);
    border-radius:9px;cursor:pointer;font-size:14.5px;color:var(--text);line-height:1.6;
  }
  .acklabel input{
    appearance:none;-webkit-appearance:none;flex:0 0 auto;width:19px;height:19px;margin:2px 0 0;
    border:1.5px solid var(--accent);border-radius:5px;background:#fff;cursor:pointer;position:relative;
  }
  .acklabel input:checked{background:var(--accent)}
  .acklabel input:checked::after{
    content:"";position:absolute;left:5.5px;top:1.5px;width:5px;height:10px;
    border:solid #fff;border-width:0 2px 2px 0;transform:rotate(43deg);
  }
  .ackbtn{
    appearance:none;font:inherit;font-size:14px;font-weight:500;margin-top:16px;
    padding:10px 22px;border-radius:9px;border:0;cursor:pointer;
    background:var(--accent);color:#fff;
  }
  .ackbtn:hover{background:#14508C}
  .ackbtn:disabled{background:var(--ok);cursor:default}
  .ackrow{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:16px}
  .ackrow .ackbtn{margin-top:0}
  .ackbtn.ghost{
    background:transparent;color:var(--text-2);border:1px solid var(--border-2);
  }
  .ackbtn.ghost:hover{background:var(--danger-soft);color:var(--danger);border-color:var(--danger)}
  .ackbtn.link{
    background:var(--accent-soft);color:var(--accent);border:1px solid transparent;
  }
  .ackbtn.link:hover{background:#D8E7F7}
  .acklabel.done{opacity:.75;cursor:default}
  .hidden{display:none}
  .ackstate{
    margin-top:14px;padding:12px 15px;border-radius:9px;font-size:13.5px;
    background:var(--ok-soft);color:var(--ok);display:flex;gap:9px;align-items:flex-start;
  }
  .ackstate.off{background:var(--warn-soft);color:var(--warn)}
  .ackstate a{color:inherit}
  .toast{
    position:fixed;left:50%;bottom:28px;transform:translateX(-50%) translateY(12px);
    background:#2C2C2A;color:#fff;font-size:13.5px;padding:11px 18px;border-radius:10px;
    box-shadow:0 6px 24px rgba(0,0,0,.18);opacity:0;pointer-events:none;
    transition:opacity .2s ease,transform .2s ease;z-index:200;
  }
  .toast.show{opacity:1;transform:translateX(-50%) translateY(0);pointer-events:auto}
  .foot{color:var(--text-3);font-size:12.5px;text-align:center;margin-top:26px;line-height:1.9}
  .backlink{
    display:inline-flex;align-items:center;gap:7px;margin-bottom:16px;font-size:13.5px;
    color:var(--accent);text-decoration:none;background:var(--accent-soft);
    padding:7px 14px;border-radius:99px;
  }
  .backlink:hover{background:#D8E7F7}
  @media (max-width:600px){
    .wrap{padding:20px 14px 80px}
    .hero,.card,.ack{padding-left:18px;padding-right:18px}
    .hero h1{font-size:20px}
  }
"""


def build_guide(md_path: Path, out_path: Path = None):
    """生成独立的使用说明页面（内容取自 md 的「零、怎么用」章节）。

    out_path 为 None 时只返回 HTML 字符串（供服务端动态渲染用）。
    """
    data = parse_md(md_path.read_text(encoding="utf-8"))
    guide_sec = None
    for sec in data["sections"]:
        if sec["title"].startswith("零"):
            guide_sec = sec
            break
    if guide_sec is None:
        guide_sec = {"title": "使用说明", "blocks": []}

    gate = find_gate_item(data)
    gate_raw = (gate["state"] if gate else "todo")   # done / skip(明确取消) / todo(从未确认)
    gate_state = "done" if gate_raw == "done" else "todo"

    body = []
    for b in guide_sec["blocks"]:
        if b.get("type") == "h3":
            body.append(f"<h2>{html_mod.escape(b['title'])}</h2>")
        elif b.get("type") == "h4":
            body.append(f"<h3>{html_mod.escape(b['title'])}</h3>")
        elif b.get("type") == "para":
            body.append(f'<p class="para">{inline_html(b["text"])}</p>')
        elif b.get("type") == "note":
            body.append(f'<div class="note">{inline_html(b["text"])}</div>')
        elif b.get("type") == "bullet":
            body.append(f'<ul class="bullets"><li class="l{b.get("level",0)}">'
                        f'{inline_html(b["text"])}</li></ul>')
        elif b.get("type") == "ordered":
            body.append(f'<ol><li>{inline_html(b["text"])}</li></ol>')
        elif b.get("type") == "code":
            body.append("<pre>" + html_mod.escape("\n".join(b["lines"])) + "</pre>")
        elif b.get("type") == "table":
            t = ["<table>"]
            for ri, row in enumerate(b["rows"]):
                tag = "th" if ri == 0 else "td"
                cells = "".join(f"<{tag}>{inline_html(c)}</{tag}>" for c in row)
                t.append(f"<tr>{cells}</tr>")
            t.append("</table>")
            body.append("".join(t))

    checked = " checked" if gate_state == "done" else ""
    # 已确认时禁用复选框，避免误点导致「取消确认」；
    # 取消确认走下面的「取消确认」按钮，二次确认后生效
    disabled = " disabled" if gate_state == "done" else ""

    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>使用说明 · 上架前 App 配置清单</title>
<style>{GUIDE_CSS}</style>
</head>
<body>
<div class="wrap">

  <a class="backlink" id="back" href="#">← 返回清单看板</a>

  <div class="hero">
    <h1>使用说明</h1>
    <p>读懂这份清单怎么用。三分钟看完，之后就能按顺序一条条推进。</p>
    <div class="meta">
      <span>共 {len(data['items'])} 项检查</span>
      <span>需按顺序完成</span>
      <span>权限配置在面板里统一做</span>
    </div>
  </div>

  <div class="card">
    {''.join(body)}
  </div>

  <div class="ack" id="ackBox">
    <h2>读完了？确认一下</h2>
    <p>勾选下面这一项，清单里的检查项才会解锁。<br>
       不确认也能看，但所有条目都是锁定的。</p>
    <label class="acklabel{'' if gate_state=='done' else ''}" id="ackLabel">
      <input type="checkbox" id="ackBox2"{checked}{disabled}>
      <span>我已读完本说明，理解三条规则：<br>
        <b>按顺序完成</b>（不能跳项，不适用就跳过）·
        <b>破坏性操作二次确认</b>（保存/清空前会弹窗）·
        <b>权限配置走面板</b>（不手改 Info.plist）</span>
    </label>
    <div class="ackstate{'' if gate_state=='done' else ' off'}" id="ackState">
      {('✓ 已确认，清单已解锁。' if gate_state=='done'
         else ('⚠ 你之前取消过确认 —— 清单中的检查项目前处于锁定状态，重新勾选即可解锁。'
               if gate_raw=='skip'
               else '⚠ 尚未确认 —— 清单中的检查项目前处于锁定状态。'))}
    </div>
    <div class="ackrow">
      <a class="ackbtn link" id="goBoard" href="#">→ 返回清单看板</a>
      <button class="ackbtn ghost{'' if gate_raw=='done' else ' hidden'}" id="btnUnack">取消确认</button>
    </div>
  </div>

  <div class="foot">
    确认状态保存在 <code>{html_mod.escape(md_path.name)}</code>，可与团队共享<br>
    <span id="built"></span>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
const MD_NAME = {json.dumps(md_path.name, ensure_ascii=False)};
let acked = {json.dumps(gate_state == "done")};
let online = false;

// 返回看板
const box = document.getElementById("ackBox2");
const state = document.getElementById("ackState");
const unackBtn = document.getElementById("btnUnack");
const goBoard = document.getElementById("goBoard");

function toast(msg){{
  const t = document.getElementById("toast");
  t.textContent = msg; t.classList.add("show");
  setTimeout(()=>t.classList.remove("show"), 2600);
}}

// 同步「已确认」状态到界面
function markAcked(on, offline){{
  acked = on;
  box.checked = on;
  box.disabled = on;                 // 已确认后禁止再点，取消走「取消确认」按钮
  unackBtn.classList.toggle("hidden", !on);
  state.className = on ? "ackstate" : "ackstate off";
  state.textContent = on
    ? (offline ? "✓ 已确认（离线模式，仅本机生效）。"
               : "✓ 已确认，清单已解锁。点下面的按钮返回看板即可开始。")
    : "⚠ 尚未确认 —— 清单中的检查项目前处于锁定状态。";
}}

// 判断是否连着本地服务
(async function(){{
  try{{
    const r = await fetch("/api/health");
    if(r.ok){{
      online = true;
      const d = await (await fetch("/api/list")).json();
      if(d.gateDone) markAcked(true, false);
    }}
  }}catch(_){{}}
  // 离线兜底：读取上次确认
  if(!acked){{
    try{{ if(localStorage.getItem("app-guide-ack")==="1") markAcked(true, true); }}catch(_){{}}
  }}
}})();

box.addEventListener("change", async () => {{
  if(!box.checked) return;
  if(online){{
    try{{
      const r = await fetch("/api/ack", {{
        method:"POST", headers:{{"Content-Type":"application/json"}}, body:"{{}}"
      }});
      if(!r.ok) throw new Error("HTTP " + r.status);
      markAcked(true, false);
      toast("已确认，清单已解锁");
      return;
    }}catch(e){{ /* 落到离线兜底 */ }}
  }}
  // 离线兜底：写 localStorage
  try{{ localStorage.setItem("app-guide-ack", "1"); }}catch(_){{}}
  markAcked(true, true);
  toast("已确认（离线模式）");
}});

// 返回看板
function goBoardFn(e){{
  if(e) e.preventDefault();
  window.location.href = online ? "/" : "上架前App配置清单.html";
}}
goBoard.addEventListener("click", goBoardFn);
document.getElementById("back").addEventListener("click", goBoardFn);

// 取消确认（需要二次确认，避免误点）
unackBtn.addEventListener("click", async () => {{
  if(!confirm("确定要取消确认吗？\\n\\n取消后清单里的检查项会重新锁定，需要重新阅读并确认《使用说明》。")) return;
  if(online){{
    try{{
      await fetch("/api/unack", {{
        method:"POST", headers:{{"Content-Type":"application/json"}}, body:"{{}}"
      }});
    }}catch(_){{}}
  }}
  try{{ localStorage.removeItem("app-guide-ack"); }}catch(_){{}}
  markAcked(false, false);
  toast("已取消确认，清单重新锁定");
}});
</script>
</body>
</html>
"""
    if out_path is None:
        return html
    atomic_write(out_path, html, encoding="utf-8")
    return out_path


# --------------------------------------------------------------------------- #
# 世代号
# --------------------------------------------------------------------------- #

def read_generation() -> int:
    try:
        return int(json.loads(STATE_FILE.read_text(encoding="utf-8")).get("generation", 1))
    except Exception:
        return 1


def bump_generation() -> int:
    gen = read_generation() + 1
    atomic_write(STATE_FILE, 
        json.dumps(
            {
                "generation": gen,
                "updated": datetime.datetime.now().isoformat(timespec="seconds"),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    return gen


# --------------------------------------------------------------------------- #
# 写回 md
# --------------------------------------------------------------------------- #

STATE_MARK = {"done": "[x]", "skip": "[-]", "todo": "[ ]"}


def apply_states(text: str, parsed: dict, states: dict) -> str:
    """按 states 把 md 中的任务标记改写。只动标记本身，其余原样保留。

    states: {id: "done" | "skip" | "todo"}
    """
    lines = text.split("\n")
    for it in parsed["items"]:
        want = states.get(it["id"])
        if want is None:
            continue
        if want is True:
            want = "done"
        elif want is False:
            want = "todo"
        mark = STATE_MARK.get(want)
        if mark is None:
            continue
        s, e = it["span"]
        line = lines[it["line"]]
        if line[s:e] not in ("[ ]", "[x]", "[X]", "[-]"):
            continue
        lines[it["line"]] = line[:s] + mark + line[e:]
    return "\n".join(lines)


BACKUP_KEEP = 5   # 只保留最近 N 个备份


def backup_md(md_path: Path) -> Optional[Path]:
    if not md_path.exists():
        return None
    ts = datetime.datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    bak = md_path.with_name(md_path.name + ".bak-" + ts)
    shutil.copy2(md_path, bak)
    # 自动保存会频繁产生备份，只保留最近几个，避免目录堆积
    try:
        baks = sorted(
            md_path.parent.glob(md_path.name + ".bak-*"),
            key=lambda x: x.stat().st_mtime,
            reverse=True,
        )
        for old in baks[BACKUP_KEEP:]:
            try:
                old.unlink()
            except OSError:
                pass
    except OSError:
        pass
    return bak


def reset_md(md_path: Path, backup: bool = False) -> int:
    """把所有检查项标记还原为 [ ]，返回被改动的条目数。

    门禁确认项（是否已读使用说明）**保留原状** —— 它与本轮进度无关，
    不应该每轮发布都重新确认一次。
    """
    text = md_path.read_text(encoding="utf-8")
    parsed = parse_md(text)
    gate = find_gate_item(parsed)
    gate_id = gate["id"] if gate else None
    targets = [it for it in parsed["items"] if it["id"] != gate_id and it["state"] != "todo"]
    if not targets:
        return 0
    if backup:
        backup_md(md_path)
    atomic_write(md_path, 
        apply_states(text, parsed, {it["id"]: "todo" for it in targets}),
        encoding="utf-8",
    )
    return len(targets)


def print_status(md_path: Path):
    data = parse_md(md_path.read_text(encoding="utf-8"))
    # 门禁项不计入检查项统计（它是使用前提，不是检查项）
    gate = find_gate_item(data)
    gate_id = gate["id"] if gate else None
    feats = data.get("features") or {"hasAccountSystem": True, "targetMinors": True}
    check_items = [
        it for it in data["items"]
        if it["id"] != gate_id and feats.get(it.get("cond"), True)
    ]
    total = len(check_items)
    done = sum(1 for it in check_items if it["state"] == "done")
    skip = sum(1 for it in check_items if it["state"] == "skip")
    print(f"\n  {data['title']}")
    print("  " + "-" * 46)
    for sec in data["sections"]:
        items = [b for b in sec["blocks"] if b.get("type") == "item" and b["id"] != gate_id]
        if not items:
            continue
        d = sum(1 for it in items if it["state"] == "done")
        s = sum(1 for it in items if it["state"] == "skip")
        pct = int(d / len(items) * 100)
        bar = "█" * int(pct / 5) + "░" * (20 - int(pct / 5))
        extra = f"  跳过 {s}" if s else ""
        print(f"  {sec['title']}")
        print(f"    {bar} {d}/{len(items)}  ({pct}%){extra}")
    print("  " + "-" * 46)
    print(f"  总计  {done}/{total}  ({int(done/total*100) if total else 0}%)"
          + (f"  跳过 {skip}" if skip else ""))
    print()


# --------------------------------------------------------------------------- #
# 静态看板构建
# --------------------------------------------------------------------------- #

def build_html(md_path: Path, out_path: Path) -> Path:
    if not TEMPLATE.exists():
        raise SystemExit(f"找不到模板文件：{TEMPLATE}")
    data = _board_payload(md_path)
    data["built"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    payload = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    profiles = json.dumps(load_profiles(), ensure_ascii=False).replace("</", "<\\/")
    html = (
        TEMPLATE.read_text(encoding="utf-8")
        .replace("__PERMISSION_RULES__", (HERE / "permission_rules.json").read_text(encoding="utf-8"))
        .replace("__PERMISSION_VISIBILITY__", (HERE / "permission_visibility.js").read_text(encoding="utf-8"))
        .replace("__BOARD_CSS__", (HERE / "board.css").read_text(encoding="utf-8"))
        .replace("__BOARD_JS__", (HERE / "board.js").read_text(encoding="utf-8"))
        .replace("__TITLE__", html_mod.escape(data["title"]))
        .replace("__DATA__", payload)
        .replace("__PROFILES__", profiles)
    )
    if out_path is None:
        return html
    atomic_write(out_path, html, encoding="utf-8")
    return out_path


# --------------------------------------------------------------------------- #
# 本地服务
# --------------------------------------------------------------------------- #

class BoardServer(ThreadingHTTPServer):
    daemon_threads = True
    md_path: Path = DEFAULT_MD
    html_path: Path = DEFAULT_HTML
    lock = None


def _board_payload(md_path: Path) -> dict:
    return document_payload(
        md_path.read_text(encoding="utf-8"), md_path.name, read_generation(),
        read_perm_state(md_path), load_review(md_path), revision(md_path),
    )


def document_payload(text, md_name, generation, permissions, review, version):
    """Pure payload construction shared by local files and cloud database records."""
    parsed = parse_md(text)
    perm_sel, perm_descs, perm_descs_en = permissions
    permission_visibility.annotate(parsed["sections"])
    permission_profiles = load_profiles()
    # 序号 = 在全文条目中的出现顺序，前端据此强制按序完成
    seq_map = {}
    for n, it in enumerate(parsed["items"], 1):
        seq_map[it["id"]] = n

    # 先标记门禁项，再构造数据（保证 gate 字段能被带出去）
    gate = find_gate_item(parsed)
    gate_id = gate["id"] if gate else None
    if gate_id:
        for it in parsed["items"]:
            if it["id"] == gate_id:
                it["gate"] = True
        for sec in parsed["sections"]:
            for b in sec["blocks"]:
                if b.get("type") == "item" and b.get("id") == gate_id:
                    b["gate"] = True

    # 序号：只有检查项参与编号，门禁项不占号
    seq_map = {}
    n = 0
    for it in parsed["items"]:
        if it.get("gate"):
            it["seq"] = ""
            continue
        n += 1
        seq_map[it["id"]] = n
        it["seq"] = n

    # 项目特征不满足的条目不计入统计（前端也会隐藏它们，口径保持一致）
    feats = parsed.get("features") or {"hasAccountSystem": True, "targetMinors": True}
    check_items = [
        it for it in parsed["items"]
        if not it.get("gate") and feats.get(it.get("cond"), True)
        and permission_visibility.visible(it.get("permissionRule"), perm_sel, permission_profiles)
    ]
    items = [
        {
            "id": it["id"],
            "text": it["text"],
            "level": it["level"],
            "state": it["state"],
            "checked": it["state"] == "done",
            "line": it["line"],
            "seq": seq_map.get(it["id"], ""),
            "gate": bool(it.get("gate")),
            "cond": it.get("cond"),
        }
        for it in parsed["items"]
    ]
    # sections 内的 item block 也要带上 seq / state，前端直接用这份结构渲染
    for sec in parsed["sections"]:
        for b in sec["blocks"]:
            if b.get("type") == "item":
                b["seq"] = seq_map.get(b["id"], "")
                b["state"] = b.get("state", "todo")
                b["checked"] = b["state"] == "done"
    for b in parsed["preamble"]:
        if b.get("type") == "item":
            b["seq"] = seq_map.get(b["id"], "")
            b["state"] = b.get("state", "todo")
            b["checked"] = b["state"] == "done"

    return {
        "title": parsed["title"],
        "preamble": parsed["preamble"],
        "sections": parsed["sections"],
        "items": items,
        "total": len(check_items),
        "done": sum(1 for i in check_items if i["state"] == "done"),
        "skipped": sum(1 for i in check_items if i["state"] == "skip"),
        "generation": generation,
        "mdName": md_name,
        "mdText": text,
        "revision": version,
        "review": review,
        "permSelected": perm_sel,
        "permDescs": perm_descs,
        "permDescsEn": perm_descs_en,
        "gateId": gate_id,
        "gateDone": bool(gate and gate["state"] == "done"),
        # todo=从未确认（允许从本机补写） / skip=明确取消过（不复活）
        "gateState": (gate["state"] if gate else "todo"),
        "features": feats,
    }


def make_handler():
    import threading

    lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        server_version = "ChecklistBoard/1.0"

        def log_message(self, fmt, *args):
            logging.info(fmt, *args)

        def _json(self, obj, code=200):
            body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _html(self, text):
            body = text.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            path = urlparse(self.path).path
            if path in ("/", "/index.html"):
                try:
                    with lock:
                        page = build_html(self.server.md_path, None)
                    self._html(page)
                except Exception as e:
                    self._json({"error": str(e)}, 500)
                return
            if path in ("/guide", "/使用说明.html", "/guide.html"):
                # 动态渲染：确认状态随 md 实时变化，不依赖 build 时的快照
                try:
                    with lock:
                        html = build_guide(self.server.md_path)
                    self._html(html)
                except Exception as e:
                    self._json({"error": str(e)}, 500)
                return
            if path == "/api/list":
                with lock:
                    try:
                        self._json(_board_payload(self.server.md_path))
                    except Exception as e:
                        logging.exception("看板操作失败：%s", path)
                        self._json({"error": str(e)}, 500)
                return
            if path == "/api/health":
                self._json({"ok": True})
                return
            if path == "/api/profiles":
                self._json(load_profiles())
                return
            # 静态资源：仅限清单所在目录内，防止路径穿越
            if path != "/" and not path.startswith("/api/"):
                try:
                    root = self.server.md_path.parent.resolve()
                    target = (root / path.lstrip("/")).resolve()
                    if root == target or root in target.parents:
                        if target.is_file() and target.suffix.lower() in (".html", ".htm", ".css", ".js", ".json", ".md", ".txt", ".png", ".jpg", ".svg"):
                            ctype = {
                                ".html": "text/html; charset=utf-8",
                                ".htm": "text/html; charset=utf-8",
                                ".css": "text/css; charset=utf-8",
                                ".js": "application/javascript; charset=utf-8",
                                ".json": "application/json; charset=utf-8",
                                ".md": "text/markdown; charset=utf-8",
                                ".txt": "text/plain; charset=utf-8",
                            }.get(target.suffix.lower(), "application/octet-stream")
                            self.send_response(200)
                            self.send_header("Content-Type", ctype)
                            self.send_header("Content-Length", str(target.stat().st_size))
                            self.send_header("Cache-Control", "no-store")
                            self.end_headers()
                            self.wfile.write(target.read_bytes())
                            return
                except Exception:
                    logging.exception("Static resource failure")
            self._json({"error": "not found"}, 404)

        def do_POST(self):
            path = urlparse(self.path).path
            origin = self.headers.get("Origin")
            if origin and origin != "http://" + self.headers.get("Host", ""):
                self._json({"error": "不允许跨站写入"}, 403)
                return
            try:
                length = int(self.headers.get("Content-Length") or 0)
                if not 0 <= length <= 2_000_000:
                    raise ValueError()
            except ValueError:
                self._json({"error": "请求体大小无效"}, 400)
                return
            raw = self.rfile.read(length) if length else b"{}"
            try:
                payload = json.loads(raw.decode("utf-8") or "{}")
            except Exception:
                self._json({"error": "invalid json"}, 400)
                return

            if not isinstance(payload, dict):
                self._json({"error": "请求必须为对象"}, 400)
                return
            if path in ("/api/backups", "/api/restore", "/api/review"):
                with lock:
                    try:
                        md_path = self.server.md_path
                        if path == "/api/backups":
                            names = sorted((x.name for x in md_path.parent.glob(md_path.name + ".bak-*")), reverse=True)
                            self._json({"backups": names})
                            return
                        if payload.get("revision") != revision(md_path):
                            self._json({"error": "文件已变化，请刷新后重试"}, 409)
                            return
                        if path == "/api/restore":
                            name = payload.get("name", "")
                            allowed = {x.name: x for x in md_path.parent.glob(md_path.name + ".bak-*")}
                            if name not in allowed:
                                self._json({"error": "备份不存在"}, 400)
                                return
                            content = allowed[name].read_text(encoding="utf-8")
                            backup_md(md_path)
                            atomic_write(md_path, content)
                            bump_generation()
                        else:
                            save_review(md_path, payload.get("review"))
                        self._json(_board_payload(md_path))
                    except Exception as e:
                        logging.exception("Review operation failed")
                        self._json({"error": str(e)}, 500)
                return
            if path == "/api/write":
                with lock:
                    try:
                        md_path = self.server.md_path
                        text = md_path.read_text(encoding="utf-8")
                        parsed = parse_md(text)
                        if payload.get("revision") != revision(md_path):
                            self._json({"error": "文件已被其他页面或程序修改，请导出当前进度后刷新再保存"}, 409)
                            return
                        states = payload.get("states") or {}
                        if not isinstance(states, dict) or any(v not in ("done", "skip", "todo") for v in states.values()):
                            self._json({"error": "状态格式无效"}, 400)
                            return
                        new_text = apply_states(text, parsed, states)
                        if new_text != text:
                            backup_md(md_path)
                            atomic_write(md_path, new_text, encoding="utf-8")
                            try:
                                build_html(md_path, self.server.html_path)
                            except Exception:
                                logging.exception("静态看板重建失败")
                        out = _board_payload(md_path)
                        out["saved"] = True
                        self._json(out)
                    except Exception as e:
                        logging.exception("看板操作失败：%s", path)
                        self._json({"error": str(e)}, 500)
                return

            if path == "/api/clear":
                with lock:
                    try:
                        md_path = self.server.md_path
                        if payload.get("revision") != revision(md_path):
                            self._json({"error": "文件已变化，请刷新后重试"}, 409)
                            return
                        n = reset_md(md_path, backup=True)
                        gen = bump_generation()
                        out = _board_payload(md_path)
                        out["cleared"] = n
                        out["generation"] = gen
                        self._json(out)
                    except Exception as e:
                        logging.exception("看板操作失败：%s", path)
                        self._json({"error": str(e)}, 500)
                return

            if path == "/api/reload":
                with lock:
                    try:
                        self._json(_board_payload(self.server.md_path))
                    except Exception as e:
                        logging.exception("看板操作失败：%s", path)
                        self._json({"error": str(e)}, 500)
                return

            if path == "/api/features":
                # 保存项目特征（决定哪些条目显示）
                with lock:
                    try:
                        md_path = self.server.md_path
                        if payload.get("revision") != revision(md_path):
                            self._json({"error": "文件已变化，请刷新后重试"}, 409)
                            return
                        feats = payload.get("features") or {}
                        changed = write_features(md_path, feats)
                        out = _board_payload(md_path)
                        out["changed"] = changed
                        self._json(out)
                    except Exception as e:
                        logging.exception("看板操作失败：%s", path)
                        self._json({"error": str(e)}, 500)
                return

            if path == "/api/ack":
                # 确认已阅读使用说明（门禁）
                with lock:
                    try:
                        md_path = self.server.md_path
                        changed = set_gate(md_path, True)
                        out = _board_payload(md_path)
                        out["changed"] = changed
                        out["acked"] = out["gateDone"]
                        self._json(out)
                    except Exception as e:
                        logging.exception("看板操作失败：%s", path)
                        self._json({"error": str(e)}, 500)
                return

            if path == "/api/unack":
                # 取消确认（用于重置流程）
                with lock:
                    try:
                        md_path = self.server.md_path
                        changed = set_gate(md_path, False)
                        out = _board_payload(md_path)
                        out["changed"] = changed
                        out["acked"] = out["gateDone"]
                        self._json(out)
                    except Exception as e:
                        logging.exception("看板操作失败：%s", path)
                        self._json({"error": str(e)}, 500)
                return

            if path == "/api/perm-config":
                # 只生成不落盘，供面板实时预览
                try:
                    profiles = load_profiles()
                    selected = payload.get("selected") or []
                    descs = payload.get("descs") or {}
                    descs_en = payload.get("descsEn") or {}
                    lang = payload.get("lang") or "zh"
                    cfg = generate_config(profiles, selected, descs, descs_en, lang=lang)
                    cfg["appendix"] = build_appendix(profiles, selected, descs, descs_en)
                    self._json(cfg)
                except Exception as e:
                    self._json({"error": str(e)}, 500)
                return

            if path == "/api/perm-write":
                # 写入 md 附录
                with lock:
                    try:
                        md_path = self.server.md_path
                        if payload.get("revision") != revision(md_path):
                            self._json({"error": "文件已变化，请刷新后重试"}, 409)
                            return
                        selected = payload.get("selected") or []
                        descs = payload.get("descs") or {}
                        descs_en = payload.get("descsEn") or {}
                        backup_md(md_path)
                        appendix = write_appendix(md_path, selected, descs, descs_en)
                        # 静态看板同步重建：刷新页面或直接打开 html 也是最新附录
                        try:
                            build_html(md_path, self.server.html_path)
                        except Exception:
                            logging.exception("静态看板重建失败")
                        out = _board_payload(md_path)
                        out["appendix"] = appendix
                        out["saved"] = True
                        self._json(out)
                    except Exception as e:
                        logging.exception("看板操作失败：%s", path)
                        self._json({"error": str(e)}, 500)
                return

            if path == "/api/perm-write-en":
                # 生成英文文档（独立文件，不动清单 md）
                with lock:
                    try:
                        selected = payload.get("selected") or []
                        descs = payload.get("descsEn") or {}
                        doc = write_english_doc(EN_DOC_FILE, selected, descs)
                        out = {
                            "saved": True,
                            "path": EN_DOC_FILE.name,
                            "lines": len(doc.splitlines()),
                            "doc": doc,
                        }
                        self._json(out)
                    except Exception as e:
                        logging.exception("看板操作失败：%s", path)
                        self._json({"error": str(e)}, 500)
                return

            if path == "/api/perm-en-preview":
                # 只预览英文文档，不落盘
                try:
                    profiles = load_profiles()
                    selected = payload.get("selected") or []
                    descs = payload.get("descsEn") or {}
                    self._json({"doc": build_english_doc(profiles, selected, descs)})
                except Exception as e:
                    self._json({"error": str(e)}, 500)
                return

            self._json({"error": "not found"}, 404)

    return Handler


def pick_port(preferred: int) -> int:
    for p in range(preferred, preferred + 50):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind(("127.0.0.1", p))
                return p
            except OSError:
                continue
    raise SystemExit("找不到可用端口")


def cmd_serve(args):
    md_path = Path(args.md).resolve()
    html_path = Path(args.out).resolve() if args.out else md_path.with_suffix(".html")
    guide_path = md_path.with_name("使用说明.html")

    if not md_path.exists():
        raise SystemExit(f"找不到清单文件：{md_path}")
    build_html(md_path, html_path)
    build_guide(md_path, guide_path)

    port = pick_port(args.port)
    srv = ThreadingHTTPServer(("127.0.0.1", port), make_handler())
    srv.md_path = md_path
    srv.html_path = html_path

    url = f"http://127.0.0.1:{port}/"
    print("\n  上架前 App 配置清单 · 本地看板已启动")
    print("  " + "-" * 46)
    print(f"  地址    {url}")
    print(f"  清单    {md_path}")
    print(f"  停止    在本窗口按 Ctrl + C")
    print("  " + "-" * 46)
    print("  所有操作都在页面上点，命令行只负责开着服务。\n")

    if not args.no_browser:
        threading_timer = __import__("threading").Timer(0.6, lambda: webbrowser.open(url))
        threading_timer.daemon = True
        threading_timer.start()

    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n  已停止看板服务。\n")
    finally:
        srv.server_close()


def open_html(path: Path):
    if platform.system() == "Darwin":
        subprocess.run(["open", str(path)], check=False)
    elif platform.system() == "Windows":
        os.startfile(str(path))  # type: ignore[attr-defined]
    else:
        subprocess.run(["xdg-open", str(path)], check=False)


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

def main():
    ap = argparse.ArgumentParser(
        description="上架前 App 配置清单 —— 后端服务与构建工具",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    ap.add_argument(
        "cmd",
        nargs="?",
        default="serve",
        choices=["serve", "status", "reset", "build", "all", "open", "guide"],
        help="子命令（默认 serve）",
    )
    ap.add_argument("--md", default=str(DEFAULT_MD), help="清单 md 路径")
    ap.add_argument("--out", default=None, help="静态看板输出路径")
    ap.add_argument("--port", type=int, default=8765, help="本地服务端口")
    ap.add_argument("--no-browser", action="store_true", help="不自动打开浏览器")
    ap.add_argument("--backup", action="store_true", help="reset 前备份 md")
    ap.add_argument("--guide", default=None, help="使用说明页面输出路径（guide 子命令）")
    args = ap.parse_args()

    md_path = Path(args.md).resolve()
    out_path = Path(args.out).resolve() if args.out else md_path.with_suffix(".html")

    if not md_path.exists():
        raise SystemExit(f"找不到清单文件：{md_path}")

    if args.cmd == "serve":
        cmd_serve(args)

    elif args.cmd == "status":
        print_status(md_path)

    elif args.cmd == "reset":
        n = reset_md(md_path, backup=args.backup)
        gen = bump_generation()
        print(f"已清理 {n} 处完成状态（{md_path.name} 恢复为全 [ ]）")
        print(f"世代号 → {gen}")

    elif args.cmd == "build":
        p = build_html(md_path, out_path)
        print(f"已生成静态看板：{p}")

    elif args.cmd == "all":
        n = reset_md(md_path, backup=args.backup)
        bump_generation()
        p = build_html(md_path, out_path)
        print(f"已清理 {n} 处完成状态")
        print(f"已生成静态看板：{p}")

    elif args.cmd == "open":
        if not out_path.exists():
            build_html(md_path, out_path)
        open_html(out_path)
        print(f"已打开：{out_path}")

    elif args.cmd == "guide":
        guide_path = Path(args.guide).resolve() if args.guide else md_path.with_name("使用说明.html")
        p = build_guide(md_path, guide_path)
        print(f"已生成使用说明页面：{p}")


if __name__ == "__main__":
    sys.exit(main())
