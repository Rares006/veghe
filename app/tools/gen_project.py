#!/usr/bin/env python3
"""Generează ControlLaptop.xcodeproj (iPhone + Mac) din fișierele din app/.

Rulează din nou după ce adaugi sau ștergi fișiere .swift:
    python3 app/tools/gen_project.py

Echipa de semnare aleasă în Xcode (DEVELOPMENT_TEAM) se păstrează.
"""
import hashlib
import re
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
PROJ = APP / "ControlLaptop.xcodeproj"


def oid(*parts):
    return hashlib.md5("/".join(parts).encode()).hexdigest()[:24].upper()


def q(s):
    s = str(s)
    if s and all(c.isalnum() or c in "._/" for c in s):
        return s
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


shared = sorted(p.relative_to(APP).as_posix() for p in (APP / "Shared").rglob("*.swift"))
ios = sorted(p.relative_to(APP).as_posix() for p in (APP / "iOS").glob("*.swift"))
mac = sorted(p.relative_to(APP).as_posix() for p in (APP / "Mac").glob("*.swift"))
assets = "Assets.xcassets"

TARGETS = {
    "ControlLaptop": {
        "sources": shared + ios,
        "product": "ControlLaptop.app",
        "settings": {
            "ASSETCATALOG_COMPILER_APPICON_NAME": "AppIcon",
            "ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME": "AccentColor",
            "CODE_SIGN_STYLE": "Automatic",
            "CURRENT_PROJECT_VERSION": "1",
            "DEVELOPMENT_TEAM": "",
            "ENABLE_PREVIEWS": "YES",
            "GENERATE_INFOPLIST_FILE": "YES",
            "INFOPLIST_FILE": "iOS/Info.plist",
            "INFOPLIST_KEY_CFBundleDisplayName": "Veghe",
            "INFOPLIST_KEY_UIApplicationSceneManifest_Generation": "YES",
            "INFOPLIST_KEY_UIApplicationSupportsIndirectInputEvents": "YES",
            "INFOPLIST_KEY_UISupportedInterfaceOrientations_iPhone": "UIInterfaceOrientationPortrait UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight",
            "INFOPLIST_KEY_UISupportedInterfaceOrientations_iPad": "UIInterfaceOrientationPortrait UIInterfaceOrientationPortraitUpsideDown UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight",
            "IPHONEOS_DEPLOYMENT_TARGET": "17.0",
            "LD_RUNPATH_SEARCH_PATHS": "$(inherited) @executable_path/Frameworks",
            "MARKETING_VERSION": "1.0",
            "PRODUCT_BUNDLE_IDENTIFIER": "ro.betania.controllaptop",
            "PRODUCT_NAME": "ControlLaptop",
            "SDKROOT": "iphoneos",
            "SWIFT_EMIT_LOC_STRINGS": "YES",
            "SWIFT_VERSION": "5.0",
            "TARGETED_DEVICE_FAMILY": "1,2",
        },
    },
    "ControlLaptopMac": {
        "sources": shared + mac,
        "product": "Veghe.app",
        "settings": {
            "ASSETCATALOG_COMPILER_APPICON_NAME": "AppIcon",
            "ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME": "AccentColor",
            "CODE_SIGN_IDENTITY": "-",
            "CODE_SIGN_STYLE": "Manual",
            "COMBINE_HIDPI_IMAGES": "YES",
            "CURRENT_PROJECT_VERSION": "1",
            "DEVELOPMENT_TEAM": "",
            "ENABLE_HARDENED_RUNTIME": "NO",
            "ENABLE_PREVIEWS": "YES",
            "GENERATE_INFOPLIST_FILE": "YES",
            "INFOPLIST_FILE": "Mac/Info.plist",
            "INFOPLIST_KEY_CFBundleDisplayName": "Veghe",
            "INFOPLIST_KEY_LSApplicationCategoryType": "public.app-category.developer-tools",
            "LD_RUNPATH_SEARCH_PATHS": "$(inherited) @executable_path/../Frameworks",
            "MACOSX_DEPLOYMENT_TARGET": "13.0",
            "MARKETING_VERSION": "1.0",
            "PRODUCT_BUNDLE_IDENTIFIER": "ro.betania.controllaptop.mac",
            "PRODUCT_NAME": "Veghe",
            "SDKROOT": "macosx",
            "SWIFT_EMIT_LOC_STRINGS": "YES",
            "SWIFT_VERSION": "5.0",
        },
    },
}

PROJECT_SETTINGS = {
    "ALWAYS_SEARCH_USER_PATHS": "NO",
    "CLANG_ENABLE_MODULES": "YES",
    "CLANG_ENABLE_OBJC_ARC": "YES",
    "COPY_PHASE_STRIP": "NO",
    "ENABLE_STRICT_OBJC_MSGSEND": "YES",
    "GCC_C_LANGUAGE_STANDARD": "gnu17",
    "GCC_NO_COMMON_BLOCKS": "YES",
    "LOCALIZATION_PREFERS_STRING_CATALOGS": "YES",
    "SWIFT_VERSION": "5.0",
}
DEBUG = {
    "DEBUG_INFORMATION_FORMAT": "dwarf",
    "ENABLE_TESTABILITY": "YES",
    "GCC_OPTIMIZATION_LEVEL": "0",
    "ONLY_ACTIVE_ARCH": "YES",
    "SWIFT_ACTIVE_COMPILATION_CONDITIONS": "DEBUG $(inherited)",
    "SWIFT_OPTIMIZATION_LEVEL": "-Onone",
}
RELEASE = {
    "DEBUG_INFORMATION_FORMAT": "dwarf-with-dsym",
    "ENABLE_NS_ASSERTIONS": "NO",
    "SWIFT_COMPILATION_MODE": "wholemodule",
    "SWIFT_OPTIMIZATION_LEVEL": "-O",
}


# Echipa aleasă în Xcode (Signing & Capabilities) stă în proiectul existent;
# o luăm de acolo, ca regenerarea să nu o șteargă. Xcode rescrie fișierul cu
# comentarii după id („ABC /* Debug */ = {”), așa că le acceptăm.
_existing = (PROJ / "project.pbxproj").read_text() if (PROJ / "project.pbxproj").exists() else ""
for _t, _cfg in TARGETS.items():
    for _name in ("Debug", "Release"):
        _block = re.search(re.escape(oid("config", _t, _name)) + r"(?: /\*[^*]*\*/)? = \{(.*?)\n\t\t\};", _existing, re.S)
        _team = _block and re.search(r"DEVELOPMENT_TEAM = (\w+);", _block.group(1))
        if _team:
            _cfg["settings"]["DEVELOPMENT_TEAM"] = _team.group(1)
            break

objects = {}  # id -> (isa, body lines)


def add(id_, isa, fields):
    objects[id_] = (isa, fields)


def fmt_settings(d):
    lines = []
    for k in sorted(d):
        lines.append(f"\t\t\t\t{q(k)} = {q(d[k])};")
    return "{\n" + "\n".join(lines) + "\n\t\t\t}"


# Fișiere și grupuri ----------------------------------------------------------
all_files = sorted(set(shared + ios + mac))
file_ref = {f: oid("ref", f) for f in all_files}
file_ref[assets] = oid("ref", assets)
file_ref["iOS/Info.plist"] = oid("ref", "iOS/Info.plist")
file_ref["Mac/Info.plist"] = oid("ref", "Mac/Info.plist")

for f, rid in file_ref.items():
    name = f.split("/")[-1]
    if f.endswith(".swift"):
        ftype = "sourcecode.swift"
    elif f.endswith(".xcassets"):
        ftype = "folder.assetcatalog"
    else:
        ftype = "text.plist.xml"
    add(rid, "PBXFileReference", {"lastKnownFileType": ftype, "path": q(name), "sourceTree": '"<group>"'})

# Arbore de grupuri după directoare.
groups = {}  # path -> list of child ids


def group_id(path):
    return oid("group", path)


for f in file_ref:
    parts = f.split("/")
    for i in range(len(parts)):
        parent = "/".join(parts[:i])
        child = "/".join(parts[: i + 1])
        groups.setdefault(parent, [])
        cid = file_ref[f] if i == len(parts) - 1 else group_id(child)
        if cid not in groups[parent]:
            groups[parent].append(cid)
        if i < len(parts) - 1:
            groups.setdefault(child, [])

products_group = oid("group", "Products")
product_ref = {}
for t, cfg in TARGETS.items():
    pid = oid("product", t)
    product_ref[t] = pid
    add(pid, "PBXFileReference", {
        "explicitFileType": "wrapper.application",
        "includeInIndex": "0",
        "path": q(cfg["product"]),
        "sourceTree": "BUILT_PRODUCTS_DIR",
    })
add(products_group, "PBXGroup", {
    "children": "(\n" + "".join(f"\t\t\t\t{product_ref[t]},\n" for t in TARGETS) + "\t\t\t)",
    "name": "Products",
    "sourceTree": '"<group>"',
})


def sort_key(cid):
    # Grupurile întâi, apoi fișierele, alfabetic.
    isa, fields = objects.get(cid, ("PBXGroup", {}))
    name = fields.get("path", "")
    return (0 if isa == "PBXGroup" else 1, name)


for path in sorted(groups, key=len, reverse=True):
    if path == "":
        continue
    children = groups[path]
    add(group_id(path), "PBXGroup", {
        "children": "(\n" + "".join(f"\t\t\t\t{c},\n" for c in sorted(children, key=sort_key)) + "\t\t\t)",
        "path": q(path.split("/")[-1]),
        "sourceTree": '"<group>"',
    })
main_group = oid("group", "<main>")
add(main_group, "PBXGroup", {
    "children": "(\n" + "".join(f"\t\t\t\t{c},\n" for c in sorted(groups[""], key=sort_key)) + f"\t\t\t\t{products_group},\n\t\t\t)",
    "sourceTree": '"<group>"',
})

# Ținte ---------------------------------------------------------------------
target_ids = {}
for t, cfg in TARGETS.items():
    tid = oid("target", t)
    target_ids[t] = tid
    src_phase = oid("sources", t)
    res_phase = oid("resources", t)
    fw_phase = oid("frameworks", t)
    src_files = []
    for f in cfg["sources"]:
        bid = oid("build", t, f)
        add(bid, "PBXBuildFile", {"fileRef": file_ref[f]})
        src_files.append(bid)
    asset_build = oid("build", t, assets)
    add(asset_build, "PBXBuildFile", {"fileRef": file_ref[assets]})
    add(src_phase, "PBXSourcesBuildPhase", {
        "buildActionMask": "2147483647",
        "files": "(\n" + "".join(f"\t\t\t\t{b},\n" for b in src_files) + "\t\t\t)",
        "runOnlyForDeploymentPostprocessing": "0",
    })
    add(res_phase, "PBXResourcesBuildPhase", {
        "buildActionMask": "2147483647",
        "files": f"(\n\t\t\t\t{asset_build},\n\t\t\t)",
        "runOnlyForDeploymentPostprocessing": "0",
    })
    add(fw_phase, "PBXFrameworksBuildPhase", {
        "buildActionMask": "2147483647",
        "files": "(\n\t\t\t)",
        "runOnlyForDeploymentPostprocessing": "0",
    })
    cfg_ids = []
    for name, extra in (("Debug", {}), ("Release", {})):
        cid = oid("config", t, name)
        cfg_ids.append(cid)
        add(cid, "XCBuildConfiguration", {"buildSettings": fmt_settings({**cfg["settings"], **extra}), "name": name})
    list_id = oid("configlist", t)
    add(list_id, "XCConfigurationList", {
        "buildConfigurations": "(\n" + "".join(f"\t\t\t\t{c},\n" for c in cfg_ids) + "\t\t\t)",
        "defaultConfigurationIsVisible": "0",
        "defaultConfigurationName": "Release",
    })
    add(tid, "PBXNativeTarget", {
        "buildConfigurationList": list_id,
        "buildPhases": f"(\n\t\t\t\t{src_phase},\n\t\t\t\t{fw_phase},\n\t\t\t\t{res_phase},\n\t\t\t)",
        "buildRules": "(\n\t\t\t)",
        "dependencies": "(\n\t\t\t)",
        "name": t,
        "productName": t,
        "productReference": product_ref[t],
        "productType": '"com.apple.product-type.application"',
    })

proj_cfgs = []
for name, extra in (("Debug", DEBUG), ("Release", RELEASE)):
    cid = oid("config", "<project>", name)
    proj_cfgs.append(cid)
    add(cid, "XCBuildConfiguration", {"buildSettings": fmt_settings({**PROJECT_SETTINGS, **extra}), "name": name})
proj_list = oid("configlist", "<project>")
add(proj_list, "XCConfigurationList", {
    "buildConfigurations": "(\n" + "".join(f"\t\t\t\t{c},\n" for c in proj_cfgs) + "\t\t\t)",
    "defaultConfigurationIsVisible": "0",
    "defaultConfigurationName": "Release",
})

root = oid("project")
add(root, "PBXProject", {
    "attributes": "{\n\t\t\t\tBuildIndependentTargetsInParallel = 1;\n\t\t\t\tLastSwiftUpdateCheck = 1520;\n\t\t\t\tLastUpgradeCheck = 1520;\n\t\t\t}",
    "buildConfigurationList": proj_list,
    "compatibilityVersion": '"Xcode 14.0"',
    "developmentRegion": "ro",
    "hasScannedForEncodings": "0",
    "knownRegions": "(\n\t\t\t\ten,\n\t\t\t\tro,\n\t\t\t\tBase,\n\t\t\t)",
    "mainGroup": main_group,
    "productRefGroup": products_group,
    "projectDirPath": '""',
    "projectRoot": '""',
    "targets": "(\n" + "".join(f"\t\t\t\t{target_ids[t]},\n" for t in TARGETS) + "\t\t\t)",
})

# Scriere -------------------------------------------------------------------
out = ["// !$*UTF8*$!", "{", "\tarchiveVersion = 1;", "\tclasses = {", "\t};", "\tobjectVersion = 56;", "\tobjects = {"]
by_isa = {}
for id_, (isa, fields) in objects.items():
    by_isa.setdefault(isa, []).append((id_, fields))
for isa in sorted(by_isa):
    out.append(f"\n/* Begin {isa} section */")
    for id_, fields in sorted(by_isa[isa]):
        if isa in ("PBXBuildFile", "PBXFileReference"):
            body = " ".join(f"{k} = {v};" for k, v in fields.items())
            out.append(f"\t\t{id_} = {{isa = {isa}; {body} }};")
        else:
            out.append(f"\t\t{id_} = {{")
            out.append(f"\t\t\tisa = {isa};")
            for k, v in fields.items():
                out.append(f"\t\t\t{k} = {v};")
            out.append("\t\t};")
    out.append(f"/* End {isa} section */")
out += ["\t};", f"\trootObject = {root};", "}", ""]

PROJ.mkdir(exist_ok=True)
(PROJ / "project.pbxproj").write_text("\n".join(out))
print(f"Scris {PROJ / 'project.pbxproj'}: {len(shared)} comune, {len(ios)} iOS, {len(mac)} Mac")
