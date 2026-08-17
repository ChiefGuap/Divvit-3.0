"""Divvit's five-way video classifier.

The taxonomy is the shared vocabulary between screening, Discover and Create;
the classifier is a teacher/student pair because no public dataset exists for
these categories (see classifier.py).
"""

from .taxonomy import CATEGORIES, TAXONOMY, UNCLASSIFIED, label, create_role
from .classifier import (
    Classification, ClassifierError, LocalClassifier, PegasusClassifier,
    classify_cascade, classify_from_archetype, classify_from_screening,
)
from .dataset import export_training_set, label_corpus, readiness

__all__ = [
    "CATEGORIES", "TAXONOMY", "UNCLASSIFIED", "label", "create_role",
    "Classification", "ClassifierError", "LocalClassifier", "PegasusClassifier",
    "classify_cascade", "classify_from_archetype", "classify_from_screening",
    "export_training_set", "label_corpus", "readiness",
]
