use super::*;
use crate::managed_agents::{
    agent_snapshot::{
        AgentSnapshotDefinition, AgentSnapshotMemory, AgentSnapshotMemoryEntry,
        AgentSnapshotProfile,
    },
    team_snapshot::{TeamSnapshotMeta, FORMAT_DISCRIMINATOR, FORMAT_VERSION},
};

fn member(name: &str) -> AgentSnapshot {
    AgentSnapshot {
        format: crate::managed_agents::agent_snapshot::FORMAT_DISCRIMINATOR.to_string(),
        version: crate::managed_agents::agent_snapshot::FORMAT_VERSION,
        definition: AgentSnapshotDefinition {
            name: name.to_string(),
            system_prompt: Some(format!("{name} prompt")),
            runtime: Some("goose".to_string()),
            model: None,
            provider: None,
            parallelism: Some(2),
            respond_to: Some("allowlist".to_string()),
            respond_to_allowlist: vec!["ab".repeat(32)],
            name_pool: vec![],
            idle_timeout_seconds: None,
            max_turn_duration_seconds: None,
        },
        profile: AgentSnapshotProfile {
            display_name: name.to_string(),
            about: None,
            avatar_data_url: None,
            avatar_url: Some(format!("https://example.test/{name}.png")),
        },
        memory: AgentSnapshotMemory {
            level: MemoryLevel::None,
            entries: vec![],
        },
    }
}

fn snapshot(members: Vec<AgentSnapshot>) -> TeamSnapshot {
    TeamSnapshot {
        format: FORMAT_DISCRIMINATOR.to_string(),
        version: FORMAT_VERSION,
        team: TeamSnapshotMeta {
            name: "Review Team".to_string(),
            description: Some("Reviews changes".to_string()),
            instructions: Some("Be thorough.".to_string()),
        },
        members,
    }
}

#[test]
fn team_export_round_trip_preserves_team_and_excludes_member_memory() {
    let definitions = vec![
        AgentDefinition {
            id: "alice".to_string(),
            display_name: "Alice".to_string(),
            avatar_url: None,
            system_prompt: "Alice prompt".to_string(),
            runtime: Some("goose".to_string()),
            model: None,
            provider: None,
            name_pool: vec![],
            is_builtin: false,
            is_active: true,
            source_team: None,
            source_team_persona_slug: None,
            env_vars: Default::default(),
            respond_to: None,
            respond_to_allowlist: vec![],
            parallelism: None,
            created_at: "now".to_string(),
            updated_at: "now".to_string(),
        },
        AgentDefinition {
            id: "bob".to_string(),
            display_name: "Bob".to_string(),
            avatar_url: None,
            system_prompt: "Bob prompt".to_string(),
            runtime: Some("goose".to_string()),
            model: None,
            provider: None,
            name_pool: vec![],
            is_builtin: false,
            is_active: true,
            source_team: None,
            source_team_persona_slug: None,
            env_vars: Default::default(),
            respond_to: None,
            respond_to_allowlist: vec![],
            parallelism: None,
            created_at: "now".to_string(),
            updated_at: "now".to_string(),
        },
    ];
    let team = TeamRecord {
        id: "review".to_string(),
        name: "Review Team".to_string(),
        description: Some("Reviews changes".to_string()),
        instructions: Some("Be thorough.".to_string()),
        persona_ids: vec!["alice".to_string(), "bob".to_string()],
        is_builtin: false,
        source_dir: None,
        is_symlink: false,
        symlink_target: None,
        version: None,
        created_at: "now".to_string(),
        updated_at: "now".to_string(),
    };

    // Export with no instances and MemoryLevel::None — memory stays empty.
    let bytes = encode_team_snapshot_json(
        &build_team_export_snapshot(
            &team,
            &definitions,
            &[],
            MemoryLevel::None,
            &std::collections::HashMap::new(),
        )
        .unwrap(),
    )
    .unwrap();
    let decoded = decode_team_snapshot_from_bytes(&bytes).unwrap();

    assert_eq!(decoded.team.name, "Review Team");
    assert_eq!(decoded.team.description.as_deref(), Some("Reviews changes"));
    assert_eq!(decoded.team.instructions.as_deref(), Some("Be thorough."));
    assert_eq!(decoded.members.len(), 2);
    assert!(decoded.members.iter().all(|member| {
        member.memory.level == MemoryLevel::None && member.memory.entries.is_empty()
    }));
}

#[test]
fn team_export_with_instance_and_memory_level_uses_supplied_entries() {
    let definitions = vec![AgentDefinition {
        id: "alice".to_string(),
        display_name: "Alice".to_string(),
        avatar_url: None,
        system_prompt: "Alice prompt".to_string(),
        runtime: Some("goose".to_string()),
        model: None,
        provider: None,
        name_pool: vec![],
        is_builtin: false,
        is_active: true,
        source_team: None,
        source_team_persona_slug: None,
        env_vars: Default::default(),
        respond_to: None,
        respond_to_allowlist: vec![],
        parallelism: None,
        created_at: "now".to_string(),
        updated_at: "now".to_string(),
    }];
    let team = TeamRecord {
        id: "t1".to_string(),
        name: "Team".to_string(),
        description: None,
        instructions: None,
        persona_ids: vec!["alice".to_string()],
        is_builtin: false,
        source_dir: None,
        is_symlink: false,
        symlink_target: None,
        version: None,
        created_at: "now".to_string(),
        updated_at: "now".to_string(),
    };

    // Build a fake instance record tied to this team+persona.
    let instance = ManagedAgentRecord {
        pubkey: "a".repeat(64),
        name: "Alice".to_string(),
        display_name: None,
        slug: None,
        persona_id: Some("alice".to_string()),
        private_key_nsec: String::new(),
        auth_tag: None,
        relay_url: String::new(),
        avatar_url: None,
        acp_command: crate::managed_agents::DEFAULT_ACP_COMMAND.to_string(),
        agent_command: String::new(),
        agent_command_override: None,
        agent_args: vec![],
        mcp_command: String::new(),
        turn_timeout_seconds: 0,
        idle_timeout_seconds: None,
        max_turn_duration_seconds: None,
        parallelism: crate::managed_agents::DEFAULT_AGENT_PARALLELISM,
        system_prompt: None,
        model: None,
        provider: None,
        persona_source_version: None,
        env_vars: Default::default(),
        start_on_app_launch: false,
        auto_restart_on_config_change: true,
        runtime_pid: None,
        backend: crate::managed_agents::BackendKind::Local,
        backend_agent_id: None,
        provider_binary_path: None,
        team_id: Some("t1".to_string()),
        persona_team_dir: None,
        persona_name_in_team: None,
        created_at: "now".to_string(),
        updated_at: "now".to_string(),
        last_started_at: None,
        last_stopped_at: None,
        last_exit_code: None,
        last_error: None,
        last_error_code: None,
        respond_to: crate::managed_agents::RespondTo::default(),
        respond_to_allowlist: vec![],
        is_builtin: false,
        is_active: true,
        source_team: None,
        source_team_persona_slug: None,
        definition_respond_to: None,
        definition_respond_to_allowlist: vec![],
        definition_parallelism: None,
        relay_mesh: None,
        runtime: None,
        name_pool: vec![],
    };

    let mut memory_map = std::collections::HashMap::new();
    memory_map.insert(
        "alice".to_string(),
        vec![
            AgentSnapshotMemoryEntry {
                slug: "core".to_string(),
                body: "Alice is an expert reviewer.".to_string(),
            },
            AgentSnapshotMemoryEntry {
                slug: "mem/pref".to_string(),
                body: "prefers concise answers".to_string(),
            },
        ],
    );

    // MemoryLevel::Everything with an instance → entries should appear.
    let snap = build_team_export_snapshot(
        &team,
        &definitions,
        std::slice::from_ref(&instance),
        MemoryLevel::Everything,
        &memory_map,
    )
    .unwrap();
    assert_eq!(snap.members[0].memory.level, MemoryLevel::Everything);
    assert_eq!(snap.members[0].memory.entries.len(), 2);

    // MemoryLevel::None → entries stripped regardless.
    let snap_none = build_team_export_snapshot(
        &team,
        &definitions,
        std::slice::from_ref(&instance),
        MemoryLevel::None,
        &memory_map,
    )
    .unwrap();
    assert_eq!(snap_none.members[0].memory.level, MemoryLevel::None);
    assert!(snap_none.members[0].memory.entries.is_empty());

    // No instance → entries stripped even with Everything level.
    let snap_no_instance = build_team_export_snapshot(
        &team,
        &definitions,
        &[],
        MemoryLevel::Everything,
        &memory_map,
    )
    .unwrap();
    assert_eq!(snap_no_instance.members[0].memory.level, MemoryLevel::None);
    assert!(snap_no_instance.members[0].memory.entries.is_empty());
}

#[test]
fn team_import_definitions_are_built_for_all_members() {
    let mut memory_bearing = member("Alice");
    memory_bearing.memory = AgentSnapshotMemory {
        level: MemoryLevel::Everything,
        entries: vec![AgentSnapshotMemoryEntry {
            slug: "core".to_string(),
            body: "must remain inert".to_string(),
        }],
    };
    let decoded = decode_team_snapshot_from_bytes(
        &encode_team_snapshot_json(&snapshot(vec![memory_bearing, member("Bob")])).unwrap(),
    )
    .unwrap();
    let definitions = build_import_definitions(&decoded, false, "now").unwrap();
    let team = build_import_team(
        &decoded,
        definitions
            .iter()
            .map(|definition| definition.id.clone())
            .collect(),
        "now",
    )
    .unwrap();

    assert_eq!(definitions.len(), 2);
    assert_eq!(team.persona_ids.len(), 2);
    assert_eq!(team.instructions.as_deref(), Some("Be thorough."));
    assert_eq!(
        team.persona_ids,
        definitions
            .iter()
            .map(|definition| definition.id.clone())
            .collect::<Vec<_>>()
    );
    assert!(definitions.iter().all(|definition| {
        definition.id.len() == 36
            && definition.source_team.is_none()
            && definition.env_vars.is_empty()
            && definition.respond_to_allowlist.is_empty()
    }));
    assert_eq!(definitions[0].system_prompt, "Alice prompt");
}

#[test]
fn team_import_keeps_or_clears_every_member_allowlist_with_one_toggle() {
    let source = snapshot(vec![member("Alice"), member("Bob")]);
    let kept = build_import_definitions(&source, true, "now").unwrap();
    let cleared = build_import_definitions(&source, false, "now").unwrap();

    assert!(kept.iter().all(|definition| {
        definition.respond_to.as_deref() == Some("allowlist")
            && definition.respond_to_allowlist == vec!["ab".repeat(32)]
    }));
    assert!(cleared.iter().all(|definition| {
        definition.respond_to.is_none() && definition.respond_to_allowlist.is_empty()
    }));
}

#[test]
fn legacy_flat_team_and_pack_zip_return_actionable_error() {
    let old_flat = br#"{"version":1,"type":"team","name":"Old"}"#;
    for bytes in [old_flat.as_slice(), b"PK\x05\x06empty-pack".as_slice()] {
        let error = decode_team_snapshot_from_bytes(bytes).unwrap_err();
        assert_eq!(error, LEGACY_TEAM_ERROR);
    }
}

#[test]
fn canonical_team_json_is_accepted_without_extension_case_policy() {
    let bytes = encode_team_snapshot_json(&snapshot(vec![member("Alice")])).unwrap();
    // Preview/confirm intentionally decode content rather than file names, so
    // canonical lowercase and uppercase extensions reach this same safe path.
    assert!(decode_team_snapshot_from_bytes(&bytes).is_ok());
}

#[test]
fn parse_memory_level_round_trips_all_variants() {
    assert_eq!(parse_memory_level("none").unwrap(), MemoryLevel::None);
    assert_eq!(parse_memory_level("").unwrap(), MemoryLevel::None);
    assert_eq!(parse_memory_level("core").unwrap(), MemoryLevel::Core);
    assert_eq!(
        parse_memory_level("everything").unwrap(),
        MemoryLevel::Everything
    );
    assert!(parse_memory_level("bad").is_err());
}
