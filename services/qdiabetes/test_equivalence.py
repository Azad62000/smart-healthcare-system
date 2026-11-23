"""Regression values published by the upstream QDiabetes R package README.

These use the same inputs as upstream QDR2018C examples and are rounded to
the published precision. For provenance see UPSTREAM_README.md and QDR2018C.R.
"""
import pytest
from main import Input, risk

@pytest.mark.parametrize("case, expected", [
    ({"sex":"Male", "age":25, "bmi":40, "hba1c":42}, 8.226301),
    ({"sex":"Female", "age":80, "bmi":28, "hba1c":15}, 0.008084487),
])
def test_matches_upstream_published_examples(case, expected):
    assert risk(Input(**case)) == pytest.approx(expected, abs=0.00001)

def test_hba1c_and_age_domain_matches_upstream():
    with pytest.raises(Exception): Input(sex="Female", age=85, bmi=25, hba1c=30)
    with pytest.raises(Exception): Input(sex="Male", age=45, bmi=25, hba1c=48)

def test_female_model_c_with_full_history_inputs():
    case = Input(sex="Female", age=60, bmi=30, hba1c=31.5, ethnicity="Indian", smoking="Ex", townsend=2,
                 family_history=True, treated_hypertension=True, cardiovascular_disease=True,
                 gestational_diabetes=True, pcos=True, learning_disability=True, psychiatric_disorder=True,
                 corticosteroids=True, statins=True, atypical_antipsychotics=True)
    assert 0 <= risk(case) <= 100
