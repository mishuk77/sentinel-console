import { Link, useParams } from "react-router-dom";
import {
    Shield,
    Scale,
    Brain,
    Database,
    ArrowRight,
    CheckCircle2,
    AlertCircle,
    Sliders
} from "lucide-react";

export default function FraudDetection() {
    const { systemId } = useParams<{ systemId: string }>();

    const configSections = [
        {
            title: "Fraud Data",
            description: "Upload and manage labeled fraud transaction datasets",
            icon: Database,
            color: "text-warn",
            bgColor: "bg-warn/10",
            link: `/systems/${systemId}/fraud/data`,
            status: "configured"
        },
        {
            title: "Fraud Models",
            description: "Train and deploy ML models for fraud scoring",
            icon: Brain,
            color: "text-info",
            bgColor: "bg-info/10",
            link: `/systems/${systemId}/fraud/models`,
            status: "configured"
        },
        {
            title: "Detection Rules",
            description: "Configure velocity checks, device fingerprinting, and behavioral patterns",
            icon: Scale,
            color: "text-info",
            bgColor: "bg-info/10",
            link: `/systems/${systemId}/fraud/rules`,
            status: "configured"
        },
        {
            title: "Risk Tiers",
            description: "Set score thresholds for Low, Medium, High, and Critical risk categorization",
            icon: Sliders,
            color: "text-info",
            bgColor: "bg-info/10",
            link: `/systems/${systemId}/fraud/tiers`,
            status: "configured"
        }
    ];

    return (
        <div className="page">
            {/* Header */}
            <div>
                <h1 className="page-title flex items-center gap-3">
                    <Shield className="h-6 w-6 text-warn" />
                    Fraud Detection Configuration
                </h1>
                <p className="page-desc">
                    Configure fraud detection rules, models, and signal providers to identify and flag suspicious activity.
                </p>
            </div>

            {/* Getting Started Banner */}
            <div className="panel border-warn/30 p-6">
                <div className="flex items-start gap-4">
                    <div className="bg-warn/10 p-3 rounded-lg">
                        <Database className="h-6 w-6 text-warn" />
                    </div>
                    <div className="flex-1">
                        <p className="font-bold text-foreground text-lg">Getting Started with Fraud Detection</p>
                        <p className="text-sm text-muted-foreground mt-2">
                            <strong>Step 1:</strong> Upload a labeled fraud dataset with historical transactions to train your fraud detection models.
                            Your dataset should include features like transaction amount, user behavior, and a fraud indicator column.
                        </p>
                        <Link
                            to={`/systems/${systemId}/fraud/data`}
                            className="btn-primary btn-sm inline-flex items-center gap-2 mt-4"
                        >
                            <Database className="h-4 w-4" />
                            Upload Fraud Dataset
                            <ArrowRight className="h-4 w-4" />
                        </Link>
                    </div>
                </div>
            </div>

            {/* Configuration Sections */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {configSections.map((section) => (
                    <Link
                        key={section.title}
                        to={section.link}
                        className="group panel p-5 hover:border-primary/50 transition-all"
                    >
                        <div className="flex items-start justify-between">
                            <div className={`p-3 rounded-lg ${section.bgColor}`}>
                                <section.icon className={`h-6 w-6 ${section.color}`} />
                            </div>
                            <div className="flex items-center gap-2 text-xs">
                                {section.status === "configured" ? (
                                    <span className="flex items-center gap-1 text-up">
                                        <CheckCircle2 className="h-3 w-3" />
                                        Configured
                                    </span>
                                ) : (
                                    <span className="flex items-center gap-1 text-muted-foreground">
                                        <AlertCircle className="h-3 w-3" />
                                        Not Configured
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="mt-4">
                            <h3 className="font-semibold text-lg flex items-center gap-2 group-hover:text-primary transition-colors">
                                {section.title}
                                <ArrowRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </h3>
                            <p className="text-sm text-muted-foreground mt-1">
                                {section.description}
                            </p>
                        </div>
                    </Link>
                ))}
            </div>

            {/* Setup Workflow */}
            <div className="panel p-5">
                <h3 className="panel-title mb-4">Setup Workflow</h3>
                <div className="space-y-4">
                    <div className="flex items-start gap-4">
                        <div className="bg-warn/10 text-warn rounded-full w-8 h-8 flex items-center justify-center font-bold text-sm flex-shrink-0">
                            1
                        </div>
                        <div>
                            <p className="font-medium">Upload Fraud Dataset</p>
                            <p className="text-sm text-muted-foreground">
                                Start by uploading historical transaction data with fraud labels to train your detection models
                            </p>
                        </div>
                    </div>
                    <div className="flex items-start gap-4">
                        <div className="bg-info/10 text-info rounded-full w-8 h-8 flex items-center justify-center font-bold text-sm flex-shrink-0">
                            2
                        </div>
                        <div>
                            <p className="font-medium">Train Fraud Models</p>
                            <p className="text-sm text-muted-foreground">
                                Use your dataset to train ML models that can identify fraudulent patterns and assign risk scores
                            </p>
                        </div>
                    </div>
                    <div className="flex items-start gap-4">
                        <div className="bg-info/10 text-info rounded-full w-8 h-8 flex items-center justify-center font-bold text-sm flex-shrink-0">
                            3
                        </div>
                        <div>
                            <p className="font-medium">Configure Detection Rules</p>
                            <p className="text-sm text-muted-foreground">
                                Set up velocity checks, behavioral patterns, and business rules to complement your ML models
                            </p>
                        </div>
                    </div>
                    <div className="flex items-start gap-4">
                        <div className="bg-info/10 text-info rounded-full w-8 h-8 flex items-center justify-center font-bold text-sm flex-shrink-0">
                            4
                        </div>
                        <div>
                            <p className="font-medium">Set Risk Tier Thresholds</p>
                            <p className="text-sm text-muted-foreground">
                                Configure score thresholds to categorize transactions into Low, Medium, High, and Critical risk tiers
                            </p>
                        </div>
                    </div>
                    <div className="flex items-start gap-4">
                        <div className="bg-up/10 text-up rounded-full w-8 h-8 flex items-center justify-center font-bold text-sm flex-shrink-0">
                            5
                        </div>
                        <div>
                            <p className="font-medium">Configure Review Workflow & Deploy</p>
                            <p className="text-sm text-muted-foreground">
                                Set up queue routing, SLA targets, and automation rules based on risk tiers
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
