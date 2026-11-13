// Presets are shipped with the app; user-created schemas are stored separately.
// Append new entries in any order. The dropdown alphabetizes each group automatically,
// with local schemas first. See README.md: "Add another built-in schema" for steps.
export const BUNDLED_SCHEMAS = [
  {
    id: 'terminal-bench-pdf-metadata',
    name: 'Terminal Bench PDF Metadata',
    selection: {
      version: 1,
      mode: 'selected',
      include: [
        '$.anti_cheating_1',
        '$.artifact_boundary_integrity_2',
        '$.difficulty_calibration_3',
        '$.hidden_requirement_gap_6',
        '$.metadata_accuracy_9',
        '$.oracle_correctness_11',
        '$.outcome_only_scoring_13',
        '$.reproducibility_14',
        '$.resource_config_15',
        '$.reviewability_16',
        '$.task_security_17',
        '$.test_instruction_alignment_18',
        '$.test_resilience_19',
        '$.trajectory_reward_hacking_20',
        '$.vacuous_pass_21',
        '$.verifier_calibration_22',
        '$.instruction_style',
        '$.doc_drift',
        '$.env_hygiene',
        '$.housekeeping',
      ],
      exclude: [],
      collection: null,
    },
  },
];
